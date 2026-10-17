import { markdownWithFrontmatter, type HarnessAdapter } from '../render.js';
import { mapCapabilities, parseToolEntry } from '../tools.js';
import type { Capability } from '../types.js';
import { scopeRoot, standardPaths, typedMcpServer, warnUnsupported } from './common.js';

const TOOLS: Record<Capability, string[]> = {
  read: ['Read'],
  search: ['Glob', 'Grep'],
  edit: ['Edit', 'Write', 'NotebookEdit'],
  execute: ['Bash'],
  web: ['WebFetch', 'WebSearch'],
  agent: ['Agent'],
  todo: ['TodoWrite'],
};

/** Maps CAF tool entries to Claude Code tool names. */
function nativeTools(entries: string[]): string[] {
  const out: string[] = [];
  for (const entry of entries) {
    const t = parseToolEntry(entry);
    const names = t.capability
      ? mapCapabilities([t.capability], TOOLS)
      : t.server
        ? [t.tool ? `mcp__${t.server}__${t.tool}` : `mcp__${t.server}`]
        : [];
    for (const n of names) if (!out.includes(n)) out.push(n);
  }
  return out;
}

export const claudeCode: HarnessAdapter = {
  id: 'claude-code',
  name: 'Claude Code',
  modelTiers: { inherit: 'inherit', fast: 'haiku', balanced: 'sonnet', strong: 'opus' },

  paths(name, scope, projectDir, homeDir) {
    return standardPaths(scopeRoot(scope, projectDir, homeDir, '.claude', '.claude'), name, '.md');
  },

  derive(input) {
    const fm = input.agent.frontmatter;
    warnUnsupported(input, 'Claude Code', ['invocation']);
    const servers = fm['mcp-servers'] ?? {};
    return {
      name: fm.name,
      description: fm.description,
      tools: fm.tools && !fm.tools.includes('*') ? nativeTools(fm.tools).join(', ') : undefined,
      disallowedTools: fm['disallowed-tools'] ? nativeTools(fm['disallowed-tools']).join(', ') : undefined,
      model: input.model,
      effort: fm.effort,
      maxTurns: fm['max-turns'],
      skills: fm.skills?.length ? fm.skills : undefined,
      mcpServers: Object.keys(servers).length
        ? Object.entries(servers).map(([name, server]) => ({ [name]: typedMcpServer(server) }))
        : undefined,
    };
  },

  serialize: markdownWithFrontmatter,
};
