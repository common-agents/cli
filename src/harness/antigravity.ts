import { join } from 'node:path';
import { markdownWithFrontmatter, type HarnessAdapter } from '../render.js';
import { allowedMcp, mapCapabilities } from '../tools.js';
import type { Capability } from '../types.js';
import { plainMcpServer, scopeRoot } from './common.js';

const TOOLS: Record<Capability, string[]> = {
  read: ['view_file', 'list_dir'],
  search: ['grep_search', 'find_by_name'],
  edit: ['replace_file_content', 'write_to_file'],
  execute: ['run_command'],
  web: ['read_url_content', 'search_web'],
  agent: ['invoke_subagent'],
  todo: ['manage_task'],
};

export const antigravity: HarnessAdapter = {
  id: 'antigravity',
  name: 'Antigravity',
  modelTiers: { inherit: 'inherit', fast: 'flash', balanced: 'flash', strong: 'pro' },

  // Each agent gets its own folder (<name>/agent.md), with skills and
  // support files beside it.
  paths(name, scope, projectDir, homeDir) {
    const root = scopeRoot(scope, projectDir, homeDir, '.agents', join('.gemini', 'config'));
    const dir = join(root, 'agents', name);
    return { agentFile: join(dir, 'agent.md'), configDir: root, skillsDir: join(dir, 'skills'), supportDir: dir };
  },

  derive(input) {
    const fm = input.agent.frontmatter;
    const { policy } = input;
    if (fm.effort) input.warn('effort is not supported by Antigravity and is left out');
    if (fm['max-turns'] !== undefined) input.warn('max-turns is not supported by Antigravity and is left out');

    // Antigravity gives an agent no tools unless they are listed.
    const tools = mapCapabilities(policy.capabilities, TOOLS);

    const servers = fm['mcp-servers'] ?? {};
    const declared = Object.keys(servers);
    const allowed = allowedMcp(policy, declared);
    const mcpServers: Record<string, unknown>[] = [];
    for (const [name, access] of allowed) {
      const server = servers[name];
      if (!server) {
        input.warn(`MCP server "${name}" is not declared in mcp-servers, so it comes from Antigravity's own configuration if at all`);
        continue;
      }
      if (access !== '*') input.refuse(`Antigravity cannot limit MCP server "${name}" to particular tools`);
      mcpServers.push({ name, ...plainMcpServer(server) });
    }

    const skills: string[] = [];
    for (const s of fm.skills ?? []) {
      if (input.bundledSkills.includes(s)) skills.push(`skills/${s}`);
      else input.warn(`skill "${s}" is not bundled; Antigravity agents see installed skills only through inherited customisations`);
    }

    return {
      name: fm.name,
      description: fm.description,
      tools,
      model: input.model,
      mainAgent: fm.invocation?.user === false ? false : undefined,
      subagent: fm.invocation?.model === false ? false : undefined,
      skills: skills.length ? skills : undefined,
      mcpServers: mcpServers.length ? mcpServers : undefined,
    };
  },

  serialize: markdownWithFrontmatter,
};
