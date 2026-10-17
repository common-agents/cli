import { join } from 'node:path';
import { markdownWithFrontmatter, type HarnessAdapter } from '../render.js';
import { parseToolEntry } from '../tools.js';
import type { Capability } from '../types.js';
import { plainMcpServer, scopeRoot, standardPaths, warnUnsupported } from './common.js';

const TAGS: Partial<Record<Capability, string>> = {
  read: 'read',
  search: 'read',
  edit: 'write',
  execute: 'shell',
  web: 'web',
  agent: 'subagent',
};

/** Maps CAF tool entries to Kiro tool tags and MCP selectors. */
function nativeTools(entries: string[], warn: (m: string) => void): string[] {
  const out: string[] = [];
  for (const entry of entries) {
    const t = parseToolEntry(entry);
    let name: string | undefined;
    if (t.all) name = '*';
    else if (t.server) name = t.tool ? `@${t.server}/${t.tool}` : `@${t.server}`;
    else if (t.capability) {
      name = TAGS[t.capability];
      if (!name) warn(`Kiro has no tool tag for ${t.capability}, so it is left out`);
    }
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

export const kiro: HarnessAdapter = {
  id: 'kiro',
  name: 'Kiro',
  modelTiers: {},

  paths(name, scope, projectDir, homeDir) {
    return standardPaths(scopeRoot(scope, projectDir, homeDir, '.kiro', '.kiro'), name, '.md');
  },

  derive(input) {
    const fm = input.agent.frontmatter;
    warnUnsupported(input, 'Kiro', ['effort', 'max-turns', 'invocation']);

    const caps = new Set(fm['disallowed-tools'] ?? []);
    if (caps.has('search') !== caps.has('read') && (caps.has('search') || caps.has('read'))) {
      input.warn('Kiro covers reading and searching with one tag, so excluding either excludes both');
    }

    const resources = input.bundledSkills
      .filter((s) => fm.skills?.includes(s))
      .map((s) => `skill://${input.displayPath(join(input.paths.skillsDir, s, 'SKILL.md'))}`);
    for (const s of fm.skills ?? []) {
      if (!input.bundledSkills.includes(s)) input.warn(`skill "${s}" is not bundled, so it is not added to the Kiro agent's resources`);
    }

    const servers = fm['mcp-servers'] ?? {};
    return {
      name: fm.name,
      description: fm.description,
      tools: fm.tools ? nativeTools(fm.tools, input.warn) : ['*'],
      excludedTools: fm['disallowed-tools'] ? nativeTools(fm['disallowed-tools'], input.warn) : undefined,
      model: input.model,
      resources: resources.length ? resources : undefined,
      mcpServers: Object.keys(servers).length
        ? Object.fromEntries(Object.entries(servers).map(([n, s]) => [n, plainMcpServer(s)]))
        : undefined,
    };
  },

  serialize: markdownWithFrontmatter,
};
