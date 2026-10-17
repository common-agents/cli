import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cli, tempWorkspace, withFixtures, writeTree } from './helpers.js';

describe('caf CLI', () => {
  it('prints its version', async () => {
    const r = await cli(['--version'], '.', '.');
    expect(r.code).toBe(0);
    expect(r.out.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('validates the default agents folder', async () => {
    const ws = tempWorkspace();
    withFixtures(ws.project);
    const r = await cli(['validate'], ws.project, ws.home);
    expect(r.code).toBe(0);
    expect(r.out).toContain('ok    .agents/caf/code-reviewer');
  });

  it('exits 1 when validation finds errors', async () => {
    const ws = tempWorkspace();
    writeTree(ws.project, { 'bad/AGENT.md': '---\nname: other\ndescription: d\n---\nbody\n' });
    const r = await cli(['validate', 'bad'], ws.project, ws.home);
    expect(r.code).toBe(1);
    expect(r.out).toContain('FAIL  bad');
  });

  it('exits 2 with a message when there are no agents', async () => {
    const ws = tempWorkspace();
    const r = await cli(['validate'], ws.project, ws.home);
    expect(r.code).toBe(2);
    expect(r.err).toContain('does not exist');
  });

  it('detects harnesses from the project', async () => {
    const ws = tempWorkspace();
    withFixtures(ws.project);
    mkdirSync(join(ws.project, '.kiro'));
    const r = await cli(['install'], ws.project, ws.home);
    expect(r.code).toBe(0);
    expect(existsSync(join(ws.project, '.kiro/agents/docs-writer.md'))).toBe(true);
    expect(existsSync(join(ws.project, '.claude'))).toBe(false);
  });

  it('asks for --harness when none is detected', async () => {
    const ws = tempWorkspace();
    withFixtures(ws.project);
    const r = await cli(['install'], ws.project, ws.home);
    expect(r.code).toBe(2);
    expect(r.err).toContain('choose one with --harness');
  });

  it('rejects unknown and unmapped harnesses', async () => {
    const ws = tempWorkspace();
    withFixtures(ws.project);
    expect((await cli(['install', '-t', 'nope'], ws.project, ws.home)).err).toContain('unknown harness "nope"');
    expect((await cli(['install', '-t', 'grok'], ws.project, ws.home)).err).toContain('has no mapping yet');
  });

  it('does not write anything on --dry-run', async () => {
    const ws = tempWorkspace();
    withFixtures(ws.project);
    const r = await cli(['install', '-t', 'claude-code', '--dry-run'], ws.project, ws.home);
    expect(r.code).toBe(0);
    expect(r.out).toContain('would create');
    expect(existsSync(join(ws.project, '.claude'))).toBe(false);
  });

  it('stops on unenforceable restrictions and explains how to proceed', async () => {
    const ws = tempWorkspace();
    withFixtures(ws.project);
    const r = await cli(['install', '-t', 'codex'], ws.project, ws.home);
    expect(r.code).toBe(1);
    expect(r.err).toContain('Codex has no per-agent setting to turn off web access');
    expect(r.err).toContain('--allow-wider-access');
    const ok = await cli(['install', '-t', 'codex', '--allow-wider-access'], ws.project, ws.home);
    expect(ok.code).toBe(0);
  });

  it('installs, lists and uninstalls', async () => {
    const ws = tempWorkspace();
    withFixtures(ws.project);
    await cli(['install', '-t', 'claude-code,kiro'], ws.project, ws.home);
    const list = await cli(['list'], ws.project, ws.home);
    expect(list.out).toContain('code-reviewer 1.0.0 → claude-code');
    const r = await cli(['uninstall', 'code-reviewer', '-t', 'kiro'], ws.project, ws.home);
    expect(r.code).toBe(0);
    expect(r.out).toContain('removed kiro/code-reviewer');
    expect(existsSync(join(ws.project, '.kiro/agents/code-reviewer.md'))).toBe(false);
    expect(existsSync(join(ws.project, '.claude/agents/code-reviewer.md'))).toBe(true);
    expect((await cli(['uninstall', 'nobody'], ws.project, ws.home)).code).toBe(1);
  });

  it('previews a harness file', async () => {
    const ws = tempWorkspace();
    const agents = withFixtures(ws.project);
    const r = await cli(['preview', join(agents, 'docs-writer'), '-t', 'claude-code'], ws.project, ws.home);
    expect(r.code).toBe(0);
    expect(r.out).toContain('# .claude/agents/docs-writer.md');
    expect(r.out).toContain('model: sonnet');
  });

  it('validates --model-tier values', async () => {
    const ws = tempWorkspace();
    withFixtures(ws.project);
    const r = await cli(['install', '-t', 'kiro', '--model-tier', 'huge=x'], ws.project, ws.home);
    expect(r.code).toBe(2);
    expect(r.err).toContain('--model-tier expects');
  });

  it('creates a new agent that validates', async () => {
    const ws = tempWorkspace();
    const r = await cli(['init', 'test-writer', '-d', 'Writes tests. Use after a change.'], ws.project, ws.home);
    expect(r.code).toBe(0);
    expect(readFileSync(join(ws.project, '.agents/caf/test-writer/AGENT.md'), 'utf8')).toContain('name: test-writer');
    expect((await cli(['validate'], ws.project, ws.home)).code).toBe(0);
    expect((await cli(['init', 'Bad_Name'], ws.project, ws.home)).code).toBe(2);
  });
});
