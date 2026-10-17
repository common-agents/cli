import { join } from 'node:path';
import type { DeriveInput } from '../render.js';
import type { McpServer, Scope } from '../types.js';

/** The directory a harness's project or user files live under. */
export function scopeRoot(scope: Scope, projectDir: string, homeDir: string, projectRel: string, userRel: string): string {
  return scope === 'project' ? join(projectDir, projectRel) : join(homeDir, userRel);
}

/**
 * Standard paths for harnesses that keep agents as <dir>/agents/<name><ext>.
 * Support files go under <dir>/caf/<name>/ so the harness does not load
 * Markdown references as agents.
 */
export function standardPaths(root: string, name: string, ext: string, skillsDir = join(root, 'skills')) {
  return {
    agentFile: join(root, 'agents', `${name}${ext}`),
    configDir: root,
    skillsDir,
    supportDir: join(root, 'caf', name),
  };
}

type Field = 'effort' | 'max-turns' | 'invocation' | 'mcp-servers' | 'skills';

/**
 * Warns about portable fields the harness cannot represent. Invocation is
 * only reported when it changes the default (either flag false).
 */
export function warnUnsupported(input: DeriveInput, harness: string, fields: Field[]) {
  const fm = input.agent.frontmatter;
  for (const field of fields) {
    switch (field) {
      case 'effort':
        if (fm.effort) input.warn(`effort is not supported by ${harness} and is left out`);
        break;
      case 'max-turns':
        if (fm['max-turns'] !== undefined) input.warn(`max-turns is not supported by ${harness} and is left out`);
        break;
      case 'invocation':
        if (fm.invocation?.user === false || fm.invocation?.model === false) {
          input.warn(`invocation limits are not supported by ${harness}; the agent can be started by anyone`);
        }
        break;
      case 'mcp-servers': {
        const servers = Object.keys(fm['mcp-servers'] ?? {});
        if (servers.length) {
          input.warn(`${harness} cannot attach MCP servers to one agent; add ${servers.join(', ')} to its MCP configuration yourself`);
        }
        break;
      }
      case 'skills':
        if (fm.skills?.length) {
          const extra = input.bundledSkills.length ? `; bundled skills are installed to ${input.displayPath(input.paths.skillsDir)}` : '';
          input.warn(`${harness} cannot preload skills into an agent${extra}`);
        }
        break;
    }
  }
}

/** MCP server config in the shape Claude Code and similar harnesses use. */
export function typedMcpServer(server: McpServer): Record<string, unknown> {
  if (server.url !== undefined) {
    return { type: 'http', url: server.url, ...(server.headers ? { headers: server.headers } : {}) };
  }
  return {
    type: 'stdio',
    command: server.command,
    ...(server.args ? { args: server.args } : {}),
    ...(server.env ? { env: server.env } : {}),
  };
}

/** MCP server config with only the CAF keys that are set. */
export function plainMcpServer(server: McpServer): Record<string, unknown> {
  return Object.fromEntries(Object.entries(server).filter(([, v]) => v !== undefined));
}
