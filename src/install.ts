import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmdirSync, statSync, unlinkSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { renderAgent, toPosix, type HarnessAdapter, type RenderOptions, type RenderResult } from './render.js';
import type { Agent, Scope } from './types.js';

export const LOCK_VERSION = 1;

export interface LockEntry {
  agent: string;
  harness: string;
  agentVersion?: string;
  /** Files written for this install, relative to the lock root, with their SHA-256. */
  files: Record<string, string>;
}

export interface LockFile {
  version: number;
  installs: Record<string, LockEntry>;
}

export type FileAction = 'create' | 'update' | 'unchanged' | 'conflict' | 'delete' | 'keep-modified';

export interface FileChange {
  path: string;
  action: FileAction;
}

export interface InstallPlan {
  results: RenderResult[];
  changes: FileChange[];
  /** Messages that stop the install unless forced or accepted. */
  blockers: string[];
}

export interface InstallOptions extends RenderOptions {
  dryRun?: boolean;
  /** Overwrite files that this tool did not write, or that were changed since. */
  force?: boolean;
  /** Install even when a harness cannot enforce a binding tool restriction. */
  allowWiderAccess?: boolean;
}

/** The directory the lock file and its relative paths are anchored to. */
export function lockRoot(scope: Scope, projectDir: string, homeDir: string): string {
  return scope === 'project' ? projectDir : homeDir;
}

export function lockPath(root: string): string {
  return join(root, '.agents', 'caf.lock.json');
}

export function readLock(root: string): LockFile {
  const file = lockPath(root);
  if (!existsSync(file)) return { version: LOCK_VERSION, installs: {} };
  const data = JSON.parse(readFileSync(file, 'utf8')) as LockFile;
  if (data.version !== LOCK_VERSION) throw new Error(`${file}: unsupported lock file version ${data.version}`);
  return data;
}

function writeLock(root: string, lock: LockFile) {
  const file = lockPath(root);
  if (Object.keys(lock.installs).length === 0) {
    if (existsSync(file)) unlinkSync(file);
    return;
  }
  mkdirSync(dirname(file), { recursive: true });
  const sorted = Object.fromEntries(Object.entries(lock.installs).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(file, `${JSON.stringify({ version: LOCK_VERSION, installs: sorted }, null, 2)}\n`);
}

export const lockKey = (harness: string, agent: string) => `${harness}/${agent}`;

const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');

function hashOnDisk(path: string): string | undefined {
  return existsSync(path) && statSync(path).isFile() ? sha256(readFileSync(path)) : undefined;
}

/** All hashes the lock records for a file, across every install. */
function recordedHashes(lock: LockFile, rel: string): Set<string> {
  const out = new Set<string>();
  for (const entry of Object.values(lock.installs)) {
    const h = entry.files[rel];
    if (h) out.add(h);
  }
  return out;
}

/**
 * Works out what installing the agents would change, without writing.
 * A file that exists and was not written by this tool (or was edited since)
 * is a conflict; files from a previous install that are no longer produced
 * are deleted if unchanged.
 */
export function planInstall(agents: Agent[], adapters: HarnessAdapter[], options: InstallOptions): InstallPlan {
  const root = lockRoot(options.scope, options.projectDir, options.homeDir);
  const lock = readLock(root);
  const plan: InstallPlan = { results: [], changes: [], blockers: [] };
  const seen = new Map<string, string>();

  for (const agent of agents) {
    for (const adapter of adapters) {
      const result = renderAgent(agent, adapter, options);
      plan.results.push(result);
      if (result.skipped) continue;
      if (result.refusals.length && !options.allowWiderAccess) {
        for (const r of result.refusals) plan.blockers.push(`${adapter.id}/${agent.frontmatter.name}: ${r}`);
      }

      const produced = new Set<string>();
      for (const file of result.files) {
        const rel = relPath(root, file.path);
        produced.add(rel);
        const newHash = sha256(file.content);
        const previous = seen.get(rel);
        if (previous !== undefined) {
          if (previous !== newHash) plan.blockers.push(`${rel} would be written with different content by two installs`);
          continue;
        }
        seen.set(rel, newHash);
        const current = hashOnDisk(file.path);
        let action: FileAction;
        if (current === undefined) action = 'create';
        else if (current === newHash) action = 'unchanged';
        else if (recordedHashes(lock, rel).has(current)) action = 'update';
        else action = 'conflict';
        plan.changes.push({ path: rel, action });
        if (action === 'conflict' && !options.force) {
          plan.blockers.push(`${rel} already exists and was not written by caf (or was edited since); use --force to overwrite`);
        }
      }

      const old = lock.installs[lockKey(adapter.id, agent.frontmatter.name)];
      for (const [rel, hash] of Object.entries(old?.files ?? {})) {
        if (produced.has(rel) || seen.has(rel)) continue;
        const current = hashOnDisk(join(root, rel));
        if (current === undefined) continue;
        plan.changes.push({ path: rel, action: current === hash ? 'delete' : 'keep-modified' });
      }
    }
  }
  return plan;
}

/** Applies a plan produced by planInstall and updates the lock file. */
export function applyInstall(plan: InstallPlan, options: InstallOptions) {
  const root = lockRoot(options.scope, options.projectDir, options.homeDir);
  const lock = readLock(root);
  const actions = new Map(plan.changes.map((c) => [c.path, c.action]));

  for (const result of plan.results) {
    if (result.skipped) continue;
    const key = lockKey(result.harness, result.agent);
    const files: Record<string, string> = {};
    for (const file of result.files) {
      const rel = relPath(root, file.path);
      files[rel] = sha256(file.content);
      const action = actions.get(rel);
      if (action === 'create' || action === 'update' || action === 'conflict') {
        mkdirSync(dirname(file.path), { recursive: true });
        writeFileSync(file.path, file.content);
        if (file.mode !== undefined) chmodSync(file.path, file.mode);
      }
    }
    lock.installs[key] = {
      agent: result.agent,
      harness: result.harness,
      ...(result.agentVersion ? { agentVersion: result.agentVersion } : {}),
      files,
    };
  }
  for (const change of plan.changes) {
    if (change.action === 'delete') removeFile(root, change.path);
  }
  writeLock(root, lock);
}

export interface UninstallOptions {
  scope: Scope;
  projectDir: string;
  homeDir: string;
  harnesses?: string[];
  dryRun?: boolean;
}

/**
 * Removes installed agents. A file is deleted only when it is unchanged
 * since it was written and no other install still uses it.
 */
export function uninstall(names: string[], options: UninstallOptions): { removed: string[]; changes: FileChange[] } {
  const root = lockRoot(options.scope, options.projectDir, options.homeDir);
  const lock = readLock(root);
  const targets = Object.entries(lock.installs).filter(
    ([, e]) => names.includes(e.agent) && (!options.harnesses || options.harnesses.includes(e.harness)),
  );
  const remaining = { ...lock.installs };
  for (const [key] of targets) delete remaining[key];

  const changes: FileChange[] = [];
  for (const [, entry] of targets) {
    for (const [rel, hash] of Object.entries(entry.files)) {
      if (changes.some((c) => c.path === rel)) continue;
      const stillUsed = Object.values(remaining).some((e) => rel in e.files);
      if (stillUsed) continue;
      const current = hashOnDisk(join(root, rel));
      if (current === undefined) continue;
      changes.push({ path: rel, action: current === hash ? 'delete' : 'keep-modified' });
    }
  }
  if (!options.dryRun) {
    for (const c of changes) if (c.action === 'delete') removeFile(root, c.path);
    writeLock(root, { version: LOCK_VERSION, installs: remaining });
  }
  return { removed: targets.map(([key]) => key), changes };
}

/** Deletes a file, then any parent directories it leaves empty, stopping at root. */
function removeFile(root: string, rel: string) {
  const abs = join(root, rel);
  if (existsSync(abs)) unlinkSync(abs);
  let dir = dirname(abs);
  while (dir.startsWith(root) && dir !== root) {
    if (!existsSync(dir) || readdirSync(dir).length > 0) break;
    rmdirSync(dir);
    dir = dirname(dir);
  }
}

function relPath(root: string, abs: string): string {
  const rel = relative(root, abs);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`${abs} is outside ${resolve(root)}`);
  return toPosix(rel);
}
