export type Capability = 'read' | 'search' | 'edit' | 'execute' | 'web' | 'agent' | 'todo';

export const CAPABILITIES: readonly Capability[] = ['read', 'search', 'edit', 'execute', 'web', 'agent', 'todo'];

/** Capabilities whose absence must be enforced by the harness (spec: "binding"). */
export const BINDING_CAPABILITIES: readonly Capability[] = ['edit', 'execute', 'web', 'agent'];

export type ModelTier = 'inherit' | 'fast' | 'balanced' | 'strong';

export const MODEL_TIERS: readonly ModelTier[] = ['inherit', 'fast', 'balanced', 'strong'];

export interface McpServer {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

export interface HarnessEntry {
  enabled?: boolean;
  settings?: Record<string, unknown>;
  path?: string;
}

export interface Frontmatter {
  name: string;
  description: string;
  caf?: string;
  version?: string;
  license?: string;
  model?: string;
  effort?: 'low' | 'medium' | 'high';
  tools?: string[];
  'disallowed-tools'?: string[];
  'max-turns'?: number;
  skills?: string[];
  'mcp-servers'?: Record<string, McpServer>;
  invocation?: { user?: boolean; model?: boolean };
  compatibility?: string;
  metadata?: Record<string, string>;
  harness?: Record<string, HarnessEntry>;
}

/** A CAF agent read from disk. */
export interface Agent {
  /** Absolute path of the agent directory. */
  dir: string;
  /** Absolute path of AGENT.md. */
  file: string;
  frontmatter: Frontmatter;
  /** Markdown body, without the frontmatter. */
  body: string;
}

export interface Issue {
  level: 'error' | 'warning';
  message: string;
}

export type Scope = 'project' | 'user';
