import { markdownWithFrontmatter, type HarnessAdapter } from '../render.js';
import { mapCapabilities } from '../tools.js';
import type { Capability } from '../types.js';
import { scopeRoot, standardPaths, warnUnsupported } from './common.js';

const TOOLS: Partial<Record<Capability, string[]>> = {
  read: ['read_file'],
  search: ['glob', 'grep_search'],
  edit: ['write_file', 'replace'],
  execute: ['run_shell_command'],
  web: ['web_fetch', 'google_web_search'],
  todo: ['write_todos'],
};

export const geminiCli: HarnessAdapter = {
  id: 'gemini-cli',
  name: 'Gemini CLI',
  modelTiers: {},

  paths(name, scope, projectDir, homeDir) {
    return standardPaths(scopeRoot(scope, projectDir, homeDir, '.gemini', '.gemini'), name, '.md');
  },

  derive(input) {
    const fm = input.agent.frontmatter;
    const { policy } = input;
    warnUnsupported(input, 'Gemini CLI', ['effort', 'invocation', 'mcp-servers', 'skills']);

    // Gemini CLI subagents get no tools unless they are listed, so the
    // list is always written out.
    const tools = mapCapabilities(policy.capabilities, TOOLS);
    if (policy.capabilities.has('agent')) input.warn('Gemini CLI subagents cannot start other agents, so agent is left out');
    if (policy.mcpAllowed.size) input.warn('MCP tools in tools are not mapped for Gemini CLI and are left out');

    return {
      name: fm.name,
      description: fm.description,
      tools,
      model: input.model,
      max_turns: fm['max-turns'],
    };
  },

  serialize: markdownWithFrontmatter,
};
