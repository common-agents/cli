import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findAgentDirs, loadAgent } from '../src/agent/load.js';
import { getAdapter } from '../src/harness/index.js';
import { applyInstall, lockPath, planInstall, readLock, uninstall, type InstallOptions } from '../src/install.js';
import { makeAgent, tempWorkspace, withFixtures, writeTree } from './helpers.js';

function setup(harnesses = ['claude-code', 'kiro']) {
  const ws = tempWorkspace();
  const agents = findAgentDirs([withFixtures(ws.project)]).map(loadAgent);
  const adapters = harnesses.map((h) => getAdapter(h)!);
  const options: InstallOptions = { scope: 'project', projectDir: ws.project, homeDir: ws.home };
  const install = (extra: Partial<InstallOptions> = {}) => {
    const plan = planInstall(agents, adapters, { ...options, ...extra });
    if (!plan.blockers.length && !extra.dryRun) applyInstall(plan, { ...options, ...extra });
    return plan;
  };
  return { ...ws, agents, adapters, options, install };
}

const actions = (plan: ReturnType<typeof planInstall>) => [...new Set(plan.changes.map((c) => c.action))];

describe('install', () => {
  it('writes files and a lock file', () => {
    const t = setup();
    const plan = t.install();
    expect(plan.blockers).toEqual([]);
    expect(actions(plan)).toEqual(['create']);
    expect(existsSync(join(t.project, '.claude/agents/code-reviewer.md'))).toBe(true);
    expect(existsSync(join(t.project, '.kiro/agents/docs-writer.md'))).toBe(true);
    const lock = readLock(t.project);
    expect(Object.keys(lock.installs)).toEqual(['claude-code/code-reviewer', 'claude-code/docs-writer', 'kiro/code-reviewer', 'kiro/docs-writer']);
    expect(lock.installs['claude-code/code-reviewer']!.agentVersion).toBe('1.0.0');
  });

  it('does nothing on a dry run', () => {
    const t = setup();
    t.install({ dryRun: true });
    expect(existsSync(lockPath(t.project))).toBe(false);
    expect(existsSync(join(t.project, '.claude'))).toBe(false);
  });

  it('is unchanged when run twice', () => {
    const t = setup();
    t.install();
    expect(actions(t.install())).toEqual(['unchanged']);
  });

  it('updates files it wrote when the agent changes', () => {
    const t = setup();
    t.install();
    appendFileSync(join(t.project, '.agents/caf/docs-writer/AGENT.md'), '5. Be brief.\n');
    t.agents.splice(0, t.agents.length, ...findAgentDirs([join(t.project, '.agents/caf')]).map(loadAgent));
    const plan = t.install();
    expect(plan.changes.filter((c) => c.action === 'update').map((c) => c.path)).toEqual([
      '.claude/agents/docs-writer.md',
      '.kiro/agents/docs-writer.md',
    ]);
    expect(readFileSync(join(t.project, '.kiro/agents/docs-writer.md'), 'utf8')).toContain('5. Be brief.');
  });

  it('refuses to overwrite files it did not write unless forced', () => {
    const t = setup(['claude-code']);
    writeTree(t.project, { '.claude/agents/docs-writer.md': 'mine\n' });
    const plan = t.install();
    expect(plan.blockers).toEqual([
      '.claude/agents/docs-writer.md already exists and was not written by caf (or was edited since); use --force to overwrite',
    ]);
    expect(readFileSync(join(t.project, '.claude/agents/docs-writer.md'), 'utf8')).toBe('mine\n');
    t.install({ force: true });
    expect(readFileSync(join(t.project, '.claude/agents/docs-writer.md'), 'utf8')).toContain('name: docs-writer');
  });

  it('blocks unenforceable restrictions unless wider access is allowed', () => {
    const t = setup(['codex']);
    expect(t.install().blockers).toHaveLength(2);
    expect(t.install({ allowWiderAccess: true }).blockers).toEqual([]);
    expect(existsSync(join(t.project, '.codex/agents/docs-writer.toml'))).toBe(true);
  });

  it('deletes files a new version no longer produces', () => {
    const ws = tempWorkspace();
    const parent = join(ws.project, '.agents/caf');
    const options: InstallOptions = { scope: 'project', projectDir: ws.project, homeDir: ws.home };
    const v1 = makeAgent(parent, 'a', 'description: d', 'b\n', { 'references/old.md': 'old\n' });
    applyInstall(planInstall([v1], [getAdapter('kiro')!], options), options);
    expect(existsSync(join(ws.project, '.kiro/caf/a/references/old.md'))).toBe(true);

    const v2 = makeAgent(join(ws.root, 'v2'), 'a', 'description: d');
    const plan = planInstall([v2], [getAdapter('kiro')!], options);
    expect(plan.changes).toContainEqual({ path: '.kiro/caf/a/references/old.md', action: 'delete' });
    applyInstall(plan, options);
    expect(existsSync(join(ws.project, '.kiro/caf'))).toBe(false);
  });

  it('installs into the home directory for user scope', () => {
    const t = setup(['claude-code']);
    t.install({ scope: 'user' });
    expect(existsSync(join(t.home, '.claude/agents/code-reviewer.md'))).toBe(true);
    expect(readLock(t.home).installs['claude-code/code-reviewer']).toBeDefined();
  });
});

describe('uninstall', () => {
  it('removes unchanged files and keeps edited ones', () => {
    const t = setup();
    t.install();
    appendFileSync(join(t.project, '.kiro/agents/docs-writer.md'), 'edit\n');
    const { removed, changes } = uninstall(['docs-writer'], { scope: 'project', projectDir: t.project, homeDir: t.home });
    expect(removed).toEqual(['claude-code/docs-writer', 'kiro/docs-writer']);
    expect(changes).toEqual([
      { path: '.claude/agents/docs-writer.md', action: 'delete' },
      { path: '.kiro/agents/docs-writer.md', action: 'keep-modified' },
    ]);
    expect(existsSync(join(t.project, '.kiro/agents/docs-writer.md'))).toBe(true);
    expect(Object.keys(readLock(t.project).installs)).toEqual(['claude-code/code-reviewer', 'kiro/code-reviewer']);
  });

  it('keeps a skill another installed agent still uses', () => {
    const ws = tempWorkspace();
    const parent = join(ws.project, '.agents/caf');
    const skill = { 'skills/shared/SKILL.md': '---\nname: shared\ndescription: d\n---\n' };
    const a = makeAgent(parent, 'a', 'description: d\nskills: [shared]', 'b\n', skill);
    const b = makeAgent(parent, 'b', 'description: d\nskills: [shared]', 'b\n', skill);
    const options: InstallOptions = { scope: 'project', projectDir: ws.project, homeDir: ws.home };
    applyInstall(planInstall([a, b], [getAdapter('claude-code')!], options), options);

    uninstall(['a'], options);
    expect(existsSync(join(ws.project, '.claude/skills/shared/SKILL.md'))).toBe(true);
    uninstall(['b'], options);
    expect(existsSync(join(ws.project, '.claude'))).toBe(false);
    expect(existsSync(lockPath(ws.project))).toBe(false);
  });
});
