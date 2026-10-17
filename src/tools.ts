import { BINDING_CAPABILITIES, CAPABILITIES, type Capability, type Frontmatter } from './types.js';

/** MCP access to one server: every tool, or the listed tools. */
export type McpAccess = '*' | Set<string>;

/**
 * The tools an agent may use, after applying `tools` and `disallowed-tools`.
 */
export interface ToolPolicy {
  /** True when `tools` or `disallowed-tools` limits the agent in any way. */
  restricted: boolean;
  /** Built-in capabilities the agent may use. */
  capabilities: Set<Capability>;
  /** True when every MCP server is allowed apart from those in `mcpDenied`. */
  mcpAll: boolean;
  /** Servers explicitly allowed (only meaningful when `mcpAll` is false). */
  mcpAllowed: Map<string, McpAccess>;
  /** Servers or tools explicitly denied. */
  mcpDenied: Map<string, McpAccess>;
}

export function parseToolEntry(entry: string): { capability?: Capability; server?: string; tool?: string; all?: true } {
  if (entry === '*') return { all: true };
  if (entry.startsWith('mcp:')) {
    const [server, tool] = entry.slice(4).split('/', 2);
    return { server, tool: tool && tool !== '*' ? tool : undefined };
  }
  return { capability: entry as Capability };
}

function addAccess(map: Map<string, McpAccess>, server: string, tool: string | undefined) {
  const current = map.get(server);
  if (tool === undefined) map.set(server, '*');
  else if (current === undefined) map.set(server, new Set([tool]));
  else if (current !== '*') current.add(tool);
}

export function resolveToolPolicy(fm: Frontmatter): ToolPolicy {
  const policy: ToolPolicy = {
    restricted: false,
    capabilities: new Set(CAPABILITIES),
    mcpAll: true,
    mcpAllowed: new Map(),
    mcpDenied: new Map(),
  };

  const tools = fm.tools;
  if (tools !== undefined && !tools.includes('*')) {
    policy.restricted = true;
    policy.capabilities = new Set();
    policy.mcpAll = false;
    for (const entry of tools) {
      const t = parseToolEntry(entry);
      if (t.capability) policy.capabilities.add(t.capability);
      if (t.server) addAccess(policy.mcpAllowed, t.server, t.tool);
    }
  }

  for (const entry of fm['disallowed-tools'] ?? []) {
    policy.restricted = true;
    const t = parseToolEntry(entry);
    if (t.all) {
      policy.capabilities.clear();
      policy.mcpAll = false;
      policy.mcpAllowed.clear();
    }
    if (t.capability) policy.capabilities.delete(t.capability);
    if (t.server) {
      addAccess(policy.mcpDenied, t.server, t.tool);
      if (t.tool === undefined) policy.mcpAllowed.delete(t.server);
      else {
        const allowed = policy.mcpAllowed.get(t.server);
        if (allowed instanceof Set) allowed.delete(t.tool);
      }
    }
  }
  return policy;
}

/** Binding capabilities the policy takes away. */
export function deniedBinding(policy: ToolPolicy): Capability[] {
  return BINDING_CAPABILITIES.filter((c) => !policy.capabilities.has(c));
}

/** Advisory capabilities the policy takes away. */
export function deniedAdvisory(policy: ToolPolicy): Capability[] {
  return CAPABILITIES.filter((c) => !BINDING_CAPABILITIES.includes(c) && !policy.capabilities.has(c));
}

/**
 * Lists MCP tool selectors the agent is allowed, given the servers it
 * declares. When every MCP server is allowed, each declared server not
 * denied as a whole is returned with access '*'.
 */
export function allowedMcp(policy: ToolPolicy, declared: string[]): Map<string, McpAccess> {
  if (!policy.mcpAll) return policy.mcpAllowed;
  const out = new Map<string, McpAccess>();
  for (const server of declared) {
    if (policy.mcpDenied.get(server) !== '*') out.set(server, '*');
  }
  return out;
}

/** Maps capabilities to native tool names, in table order, without duplicates. */
export function mapCapabilities(capabilities: Iterable<Capability>, table: Partial<Record<Capability, string[]>>): string[] {
  const out: string[] = [];
  const set = new Set(capabilities);
  for (const cap of CAPABILITIES) {
    if (!set.has(cap)) continue;
    for (const name of table[cap] ?? []) if (!out.includes(name)) out.push(name);
  }
  return out;
}
