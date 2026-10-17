import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import YAML from 'yaml';
import type { Agent, Frontmatter } from '../types.js';

export const AGENT_FILE = 'AGENT.md';

export class AgentLoadError extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`);
    this.name = 'AgentLoadError';
  }
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/**
 * Splits a Markdown document into its YAML frontmatter (parsed) and body.
 * Throws when the document has no frontmatter or the YAML is invalid.
 */
export function parseMarkdown(source: string, path = '<input>'): { data: unknown; body: string } {
  const text = source.replace(/^﻿/, '');
  const match = text.match(FRONTMATTER);
  if (!match) throw new AgentLoadError(path, 'missing YAML frontmatter (the file must start with a --- line)');
  let data: unknown;
  try {
    data = YAML.parse(match[1] ?? '');
  } catch (err) {
    throw new AgentLoadError(path, `invalid YAML frontmatter: ${(err as Error).message}`);
  }
  const body = text.slice(match[0].length).replace(/^(\s*\r?\n)+/, '');
  return { data: data ?? {}, body };
}

/**
 * Reads the agent in `dir`. The frontmatter is returned as parsed; it is not
 * validated, so callers should run validateAgent before relying on its fields.
 */
export function loadAgent(dir: string): Agent {
  const abs = resolve(dir);
  const file = join(abs, AGENT_FILE);
  if (!existsSync(file)) throw new AgentLoadError(abs, `no ${AGENT_FILE} in this directory`);
  const { data, body } = parseMarkdown(readFileSync(file, 'utf8'), file);
  if (typeof data !== 'object' || Array.isArray(data)) {
    throw new AgentLoadError(file, 'frontmatter must be a YAML mapping');
  }
  return { dir: abs, file, frontmatter: data as Frontmatter, body };
}

/**
 * Expands each path into agent directories: a path that contains AGENT.md
 * is an agent; otherwise each immediate subdirectory containing AGENT.md is.
 */
export function findAgentDirs(paths: string[]): string[] {
  const found: string[] = [];
  for (const p of paths) {
    const abs = resolve(p);
    if (!existsSync(abs) || !statSync(abs).isDirectory()) {
      throw new AgentLoadError(abs, 'not a directory');
    }
    if (existsSync(join(abs, AGENT_FILE))) {
      found.push(abs);
      continue;
    }
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      if (entry.isDirectory() && existsSync(join(abs, entry.name, AGENT_FILE))) {
        found.push(join(abs, entry.name));
      }
    }
  }
  return [...new Set(found)].sort();
}

/** Names of skills bundled in the agent's skills/ directory. */
export function bundledSkills(agent: Agent): string[] {
  const dir = join(agent.dir, 'skills');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(dir, e.name, 'SKILL.md')))
    .map((e) => e.name)
    .sort();
}
