import { markdownWithFrontmatter, type HarnessAdapter } from '../render.js';
import { deniedAdvisory } from '../tools.js';
import { scopeRoot, standardPaths, warnUnsupported } from './common.js';

export const cursor: HarnessAdapter = {
  id: 'cursor',
  name: 'Cursor',
  modelTiers: { inherit: 'inherit', fast: 'fast' },

  paths(name, scope, projectDir, homeDir) {
    return standardPaths(scopeRoot(scope, projectDir, homeDir, '.cursor', '.cursor'), name, '.md');
  },

  derive(input) {
    const fm = input.agent.frontmatter;
    const { policy } = input;
    warnUnsupported(input, 'Cursor', ['effort', 'max-turns', 'invocation', 'mcp-servers', 'skills']);

    // Cursor's only tool control is readonly, which removes editing and
    // shell commands together.
    let readonly: boolean | undefined;
    if (policy.restricted) {
      const edit = policy.capabilities.has('edit');
      const execute = policy.capabilities.has('execute');
      if (!edit && !execute) readonly = true;
      else if (!edit) input.refuse('Cursor can only remove file editing together with shell commands (readonly)');
      else if (!execute) input.refuse('Cursor can only remove shell commands together with file editing (readonly)');
      if (!policy.capabilities.has('web')) input.refuse('Cursor has no per-agent setting to turn off web access');
      if (!policy.capabilities.has('agent')) input.refuse('Cursor has no per-agent setting to stop an agent starting other agents');
      const advisory = deniedAdvisory(policy);
      if (advisory.length) input.warn(`Cursor cannot remove ${advisory.join(', ')}, so the agent keeps access to ${advisory.length > 1 ? 'them' : 'it'}`);
      if (!policy.mcpAll || policy.mcpDenied.size) input.warn('Cursor agents get every MCP server configured for the session; tools cannot limit them');
    }

    return {
      name: fm.name,
      description: fm.description,
      model: input.model,
      readonly,
    };
  },

  serialize: markdownWithFrontmatter,
};
