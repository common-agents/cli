import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AgentLoadError, findAgentDirs, loadAgent, parseMarkdown } from '../src/agent/load.js';
import { validateAgent } from '../src/agent/validate.js';
import { FIXTURES, makeAgent, tempWorkspace, writeTree } from './helpers.js';

const errors = (agent: Parameters<typeof validateAgent>[0]) =>
  validateAgent(agent).filter((i) => i.level === 'error').map((i) => i.message);
const warnings = (agent: Parameters<typeof validateAgent>[0]) =>
  validateAgent(agent).filter((i) => i.level === 'warning').map((i) => i.message);

describe('parseMarkdown', () => {
  it('splits frontmatter from the body', () => {
    const { data, body } = parseMarkdown('---\nname: a\n---\n\nHello\n');
    expect(data).toEqual({ name: 'a' });
    expect(body).toBe('Hello\n');
  });

  it('rejects a file without frontmatter', () => {
    expect(() => parseMarkdown('# Hello\n')).toThrow(AgentLoadError);
  });

  it('rejects invalid YAML', () => {
    expect(() => parseMarkdown('---\nname: [a\n---\n')).toThrow(/invalid YAML/);
  });
});

describe('findAgentDirs', () => {
  it('accepts an agent folder or a folder of agents', () => {
    expect(findAgentDirs([join(FIXTURES, 'docs-writer')])).toEqual([join(FIXTURES, 'docs-writer')]);
    expect(findAgentDirs([FIXTURES])).toEqual([join(FIXTURES, 'code-reviewer'), join(FIXTURES, 'docs-writer')]);
  });
});

describe('validateAgent', () => {
  it('passes the example agents with no issues', () => {
    for (const name of ['code-reviewer', 'docs-writer']) {
      expect(validateAgent(loadAgent(join(FIXTURES, name)))).toEqual([]);
    }
  });

  it('requires name and description', () => {
    const { project } = tempWorkspace();
    writeTree(project, { 'x/AGENT.md': '---\nfoo: 1\n---\nbody\n' });
    const errs = errors(loadAgent(join(project, 'x')));
    expect(errs.some((e) => e.includes("must have required property 'name'"))).toBe(true);
    expect(errs.some((e) => e.includes("must have required property 'description'"))).toBe(true);
  });

  it('rejects a name that does not match the folder', () => {
    const { project } = tempWorkspace();
    writeTree(project, { 'right/AGENT.md': '---\nname: wrong\ndescription: d\n---\nbody\n' });
    expect(errors(loadAgent(join(project, 'right')))).toContain('name "wrong" does not match the directory name "right"');
  });

  it('rejects bad names, tool entries and effort values', () => {
    const { project } = tempWorkspace();
    writeTree(project, { 'Bad-Name/AGENT.md': '---\nname: Bad-Name\ndescription: d\ntools: [Bash]\neffort: max\n---\nbody\n' });
    const errs = errors(loadAgent(join(project, 'Bad-Name')));
    expect(errs.some((e) => e.startsWith('name:'))).toBe(true);
    expect(errs.some((e) => e.startsWith('tools.0:'))).toBe(true);
    expect(errs.some((e) => e.startsWith('effort:'))).toBe(true);
  });

  it('rejects a newer major spec version', () => {
    const { project } = tempWorkspace();
    const agent = makeAgent(project, 'a', 'description: d\ncaf: "2.0"');
    expect(errors(agent)).toContain('caf 2.0 is newer than this tool supports (1.x)');
  });

  it('warns about unknown fields, empty bodies and unbundled skills', () => {
    const { project } = tempWorkspace();
    const agent = makeAgent(project, 'a', 'description: d\ncolour: blue\nskills: [missing]', '');
    const w = warnings(agent);
    expect(w).toContain('unknown field "colour" is ignored');
    expect(w).toContain('the body is empty, so the agent has no instructions');
    expect(w).toContain('skill "missing" is not bundled in skills/, so it must already be installed in the harness');
  });

  it('checks bundled skill names and settings files', () => {
    const { project } = tempWorkspace();
    const agent = makeAgent(project, 'a', 'description: d\nskills: [s]', 'body\n', {
      'skills/s/SKILL.md': '---\nname: other\ndescription: d\n---\n',
      'harness/claude-code/settings.yaml': 'a: 1\n',
      'harness/claude-code/settings.json': '{}',
    });
    const errs = errors(agent);
    expect(errs).toContain('skills/s/SKILL.md has name "other", expected "s"');
    expect(errs).toContain('harness/claude-code/ has more than one settings file: settings.yaml, settings.json');
  });

  it('warns about unregistered harness IDs but accepts reverse-domain ones', () => {
    const { project } = tempWorkspace();
    const agent = makeAgent(project, 'a', 'description: d\nharness:\n  mystery: {}\n  com.example.tool: {}');
    expect(warnings(agent)).toEqual(['harness "mystery" is not a registered harness ID or a reverse-domain name']);
  });
});
