import { join } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { describe, expect, it } from 'vitest';
import YAML from 'yaml';
import { loadAgent, parseMarkdown } from '../src/agent/load.js';
import { ADAPTERS, getAdapter } from '../src/harness/index.js';
import { deepMerge, renderAgent, rewriteLinks, type RenderOptions, type RenderResult } from '../src/render.js';
import { FIXTURES, makeAgent, tempWorkspace } from './helpers.js';

const ws = tempWorkspace();
const opts: RenderOptions = { scope: 'project', projectDir: ws.project, homeDir: ws.home };

function render(agentDir: string, harness: string, options: Partial<RenderOptions> = {}): RenderResult {
  return renderAgent(loadAgent(agentDir), getAdapter(harness)!, { ...opts, ...options });
}

/** The generated agent file's frontmatter and body. */
function mainFile(result: RenderResult) {
  const file = result.files.find((f) => f.kind === 'agent')!;
  const text = file.content.toString();
  // Codex agents are TOML, so only Markdown files are split.
  const parsed = text.startsWith('---') ? parseMarkdown(text) : { data: undefined, body: '' };
  return { path: file.path, text, ...parsed };
}

const reviewer = join(FIXTURES, 'code-reviewer');
const writer = join(FIXTURES, 'docs-writer');

describe('helpers', () => {
  it('deepMerge merges nested objects and replaces arrays', () => {
    expect(deepMerge({ a: { b: 1, c: 2 }, d: [1] }, { a: { c: 3 }, d: [2] })).toEqual({ a: { b: 1, c: 3 }, d: [2] });
  });

  it('rewriteLinks points references, assets and skills at installed paths', () => {
    const body = 'See [x](references/a.md), [y](./assets/b.png), [z](skills/s/SKILL.md) and [w](https://e.com/references/c).';
    expect(rewriteLinks(body, '.claude/caf/a', '.claude/skills')).toBe(
      'See [x](.claude/caf/a/references/a.md), [y](.claude/caf/a/assets/b.png), [z](.claude/skills/s/SKILL.md) and [w](https://e.com/references/c).',
    );
  });
});

describe('common pipeline', () => {
  it('skips a harness disabled in the agent', () => {
    expect(render(reviewer, 'codex').skipped).toBe(true);
  });

  it('merges settings: derived, then settings file, then inline settings', () => {
    const { data } = mainFile(render(reviewer, 'claude-code'));
    const fm = data as Record<string, unknown>;
    expect(fm.permissionMode).toBe('plan');
    expect(fm.disallowedTools).toEqual(['Write', 'Edit', 'NotebookEdit']);
    expect(fm.hooks).toBeDefined();
  });

  it('inline settings override the settings file', () => {
    const { project } = tempWorkspace();
    const agent = makeAgent(project, 'a', 'description: d\nharness:\n  claude-code:\n    settings:\n      color: red', 'b\n', {
      'harness/claude-code/settings.json': '{"color": "blue", "effort": "low"}',
    });
    const { data } = mainFile(renderAgent(agent, getAdapter('claude-code')!, opts));
    expect(data).toMatchObject({ color: 'red', effort: 'low' });
  });

  it('appends or replaces with instructions.md', () => {
    const { project } = tempWorkspace();
    const append = makeAgent(project, 'a', 'description: d', 'Main.\n', { 'harness/kiro/instructions.md': 'Kiro only.\n' });
    expect(mainFile(renderAgent(append, getAdapter('kiro')!, opts)).body).toBe('Main.\n\nKiro only.\n');
    const replace = makeAgent(project, 'b', 'description: d', 'Main.\n', {
      'harness/kiro/instructions.md': '<!-- caf:replace -->\nOnly this.\n',
    });
    expect(mainFile(renderAgent(replace, getAdapter('kiro')!, opts)).body).toBe('Only this.\n');
  });

  it('reads TOML settings', () => {
    const { project } = tempWorkspace();
    const agent = makeAgent(project, 'a', 'description: d', 'b\n', { 'harness/codex/settings.toml': 'model_verbosity = "low"\n' });
    const text = mainFile(renderAgent(agent, getAdapter('codex')!, opts)).text;
    expect(parseToml(text).model_verbosity).toBe('low');
  });

  it('copies skills, references and harness files, keeping file modes', () => {
    const files = render(reviewer, 'claude-code').files;
    const rel = (p: string) => p.slice(ws.project.length + 1);
    expect(files.map((f) => `${f.kind}:${rel(f.path)}`)).toEqual([
      'agent:.claude/agents/code-reviewer.md',
      'skill:.claude/skills/review-checklist/SKILL.md',
      'support:.claude/caf/code-reviewer/references/severity.md',
      'harness-file:.claude/hooks/block-git-push.sh',
    ]);
    expect(files.find((f) => f.kind === 'harness-file')!.mode! & 0o111).not.toBe(0);
  });

  it('uses absolute paths in links for user scope', () => {
    const { body } = mainFile(render(reviewer, 'claude-code', { scope: 'user' }));
    expect(body).toContain(`](${ws.home}/.claude/caf/code-reviewer/references/severity.md)`);
  });

  it('applies model tier overrides, harness-specific ones last', () => {
    const r = render(writer, 'codex', { modelTiers: { '*': { balanced: 'x' }, codex: { balanced: 'y' } } });
    expect(parseToml(mainFile(r).text).model).toBe('y');
  });

  it('warns when a tier has no mapping', () => {
    expect(render(writer, 'copilot').warnings[0]).toMatch(/model tier "balanced" has no mapping for GitHub Copilot/);
  });
});

describe('adapters', () => {
  it('every adapter writes a parseable file for both examples', () => {
    for (const adapter of ADAPTERS) {
      for (const dir of [reviewer, writer]) {
        const r = renderAgent(loadAgent(dir), adapter, opts);
        if (r.skipped) continue;
        const text = mainFile(r).text;
        if (adapter.id === 'codex') expect(parseToml(text).name).toBeDefined();
        else expect((YAML.parse(text.split('---\n')[1]!) as { name: string }).name).toBeDefined();
      }
    }
  });

  it('claude-code maps tools, model tier, effort and skills', () => {
    const { data, path } = mainFile(render(reviewer, 'claude-code'));
    expect(path).toBe(join(ws.project, '.claude/agents/code-reviewer.md'));
    expect(data).toMatchObject({ tools: 'Read, Glob, Grep, Bash', model: 'opus', effort: 'high', maxTurns: 30, skills: ['review-checklist'] });
  });

  it('copilot uses capability aliases and invocation flags', () => {
    const { project } = tempWorkspace();
    const agent = makeAgent(project, 'a', 'description: d\ntools: [read, mcp:gh/search]\ninvocation:\n  model: false\n  user: false');
    const { data, path } = mainFile(renderAgent(agent, getAdapter('copilot')!, opts));
    expect(path.endsWith('.github/agents/a.agent.md')).toBe(true);
    expect(data).toMatchObject({ tools: ['read', 'gh/search'], 'disable-model-invocation': true, 'user-invocable': false });
  });

  it('codex writes TOML, turns off the shell and refuses unenforceable limits', () => {
    const r = render(writer, 'codex');
    const toml = parseToml(mainFile(r).text) as Record<string, unknown>;
    expect(toml.developer_instructions).toContain("You keep a project's documentation");
    expect(toml.features).toEqual({ shell_tool: false });
    expect(r.refusals).toEqual([
      'Codex has no per-agent setting to turn off web access',
      'Codex has no per-agent setting to stop an agent starting other agents',
    ]);
  });

  it('codex escapes triple quotes in the instructions', () => {
    const { project } = tempWorkspace();
    const agent = makeAgent(project, 'a', 'description: d', 'Say """hi""" and \\n.\n');
    const toml = parseToml(mainFile(renderAgent(agent, getAdapter('codex')!, opts)).text);
    expect(toml.developer_instructions).toBe('Say """hi""" and \\n.\n');
  });

  it('gemini-cli always lists tools', () => {
    const { project } = tempWorkspace();
    const agent = makeAgent(project, 'a', 'description: d');
    const { data } = mainFile(renderAgent(agent, getAdapter('gemini-cli')!, opts));
    expect((data as { tools: string[] }).tools).toContain('run_shell_command');
  });

  it('cursor uses readonly when editing and shell are both removed', () => {
    const { project } = tempWorkspace();
    const agent = makeAgent(project, 'a', 'description: d\ndisallowed-tools: [edit, execute]');
    const r = renderAgent(agent, getAdapter('cursor')!, opts);
    expect(mainFile(r).data).toMatchObject({ readonly: true });
    expect(r.refusals).toEqual([]);
  });

  it('kiro maps tags, excluded tools, MCP servers and skill resources', () => {
    const { project } = tempWorkspace();
    const agent = makeAgent(
      project,
      'a',
      'description: d\ndisallowed-tools: [execute]\nskills: [s]\nmcp-servers:\n  gh:\n    command: gh-mcp\n    env:\n      TOKEN: ${TOKEN}',
      'b\n',
      { 'skills/s/SKILL.md': '---\nname: s\ndescription: d\n---\n' },
    );
    const { data } = mainFile(renderAgent(agent, getAdapter('kiro')!, opts));
    expect(data).toEqual({
      name: 'a',
      description: 'd',
      tools: ['*'],
      excludedTools: ['shell'],
      resources: ['skill://.kiro/skills/s/SKILL.md'],
      mcpServers: { gh: { command: 'gh-mcp', env: { TOKEN: '${TOKEN}' } } },
    });
  });

  it('antigravity uses a folder, exact tool names and invocation flags', () => {
    const { project } = tempWorkspace();
    const agent = makeAgent(project, 'a', 'description: d\nmodel: strong\ntools: [read, execute]\ninvocation:\n  user: false');
    const { data, path } = mainFile(renderAgent(agent, getAdapter('antigravity')!, opts));
    expect(path).toBe(join(ws.project, '.agents/agents/a/agent.md'));
    expect(data).toEqual({ name: 'a', description: 'd', tools: ['view_file', 'list_dir', 'run_command'], model: 'pro', mainAgent: false });
  });

  it('antigravity refuses to widen a single-tool MCP limit', () => {
    const { project } = tempWorkspace();
    const agent = makeAgent(project, 'a', 'description: d\ntools: [mcp:gh/search]\nmcp-servers:\n  gh:\n    url: https://x.example/mcp');
    const r = renderAgent(agent, getAdapter('antigravity')!, opts);
    expect(r.refusals).toEqual(['Antigravity cannot limit MCP server "gh" to particular tools']);
  });
});
