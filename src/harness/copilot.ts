import { markdownWithFrontmatter, type HarnessAdapter } from '../render.js';
import { allowedMcp } from '../tools.js';
import { CAPABILITIES } from '../types.js';
import { scopeRoot, standardPaths, warnUnsupported } from './common.js';

const BODY_LIMIT = 30_000;

export const copilot: HarnessAdapter = {
  id: 'copilot',
  name: 'GitHub Copilot',
  modelTiers: {},

  paths(name, scope, projectDir, homeDir) {
    return standardPaths(scopeRoot(scope, projectDir, homeDir, '.github', '.copilot'), name, '.agent.md');
  },

  derive(input) {
    const fm = input.agent.frontmatter;
    const { policy } = input;
    warnUnsupported(input, 'GitHub Copilot', ['effort', 'max-turns', 'skills']);
    if (input.agent.body.length > BODY_LIMIT) {
      input.warn(`the body is longer than Copilot cloud agent's ${BODY_LIMIT}-character limit`);
    }

    // Copilot's tool aliases are the CAF capability names.
    let tools: string[] | undefined;
    if (policy.restricted) {
      const declared = Object.keys(fm['mcp-servers'] ?? {});
      tools = CAPABILITIES.filter((c) => policy.capabilities.has(c));
      for (const [server, access] of allowedMcp(policy, declared)) {
        if (access === '*') tools.push(`${server}/*`);
        else for (const tool of access) tools.push(`${server}/${tool}`);
      }
      if (policy.mcpAll) {
        input.warn('disallowed-tools is written as an allowlist, so MCP tools from servers not declared in mcp-servers are not available');
      }
    }

    const servers = fm['mcp-servers'] ?? {};
    let mcp: Record<string, unknown> | undefined;
    if (Object.keys(servers).length) {
      input.warn('mcp-servers is used by Copilot cloud agent only; VS Code ignores it');
      mcp = Object.fromEntries(
        Object.entries(servers).map(([name, s]) => [
          name,
          s.url !== undefined
            ? { type: 'http', url: s.url, ...(s.headers ? { headers: s.headers } : {}), tools: ['*'] }
            : { type: 'local', command: s.command, ...(s.args ? { args: s.args } : {}), tools: ['*'], ...(s.env ? { env: s.env } : {}) },
        ]),
      );
    }

    return {
      name: fm.name,
      description: fm.description,
      tools,
      model: input.model,
      'disable-model-invocation': fm.invocation?.model === false ? true : undefined,
      'user-invocable': fm.invocation?.user === false ? false : undefined,
      'mcp-servers': mcp,
      metadata: fm.metadata,
    };
  },

  serialize: markdownWithFrontmatter,
};
