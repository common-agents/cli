import { join } from 'node:path';
import { stringify } from 'smol-toml';
import type { HarnessAdapter } from '../render.js';
import { deniedAdvisory } from '../tools.js';
import { scopeRoot, standardPaths, warnUnsupported } from './common.js';

/** Writes a TOML multi-line basic string. */
function multiline(text: string): string {
  const escaped = text.replace(/\\/g, '\\\\').replace(/"""/g, '""\\"');
  return `"""\n${escaped}"""`;
}

function isTable(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const codex: HarnessAdapter = {
  id: 'codex',
  name: 'Codex',
  modelTiers: {},

  paths(name, scope, projectDir, homeDir) {
    const root = scopeRoot(scope, projectDir, homeDir, '.codex', '.codex');
    // Codex reads skills from .agents/skills in the repository or home directory.
    const skills = scope === 'project' ? join(projectDir, '.agents', 'skills') : join(homeDir, '.agents', 'skills');
    return standardPaths(root, name, '.toml', skills);
  },

  derive(input) {
    const fm = input.agent.frontmatter;
    const { policy } = input;
    warnUnsupported(input, 'Codex', ['max-turns', 'invocation', 'mcp-servers', 'skills']);

    const features: Record<string, unknown> = {};
    if (policy.restricted) {
      if (!policy.capabilities.has('execute')) features.shell_tool = false;
      if (!policy.capabilities.has('edit')) {
        input.refuse('Codex cannot stop one agent editing files (agents cannot override sandbox_mode)');
      }
      if (!policy.capabilities.has('web')) input.refuse('Codex has no per-agent setting to turn off web access');
      if (!policy.capabilities.has('agent')) input.refuse('Codex has no per-agent setting to stop an agent starting other agents');
      const advisory = deniedAdvisory(policy);
      if (advisory.length) input.warn(`Codex cannot remove ${advisory.join(', ')}, so the agent keeps access to ${advisory.length > 1 ? 'them' : 'it'}`);
      if (!policy.mcpAll || policy.mcpDenied.size) {
        input.warn('Codex agents get every MCP server configured for the session; tools cannot limit them');
      }
    }

    return {
      name: fm.name,
      description: fm.description,
      model: input.model,
      model_reasoning_effort: fm.effort,
      ...(Object.keys(features).length ? { features } : {}),
    };
  },

  serialize(fields, body) {
    const clean = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
    const scalars = Object.fromEntries(Object.entries(clean).filter(([, v]) => !isTable(v)));
    const tables = Object.fromEntries(Object.entries(clean).filter(([, v]) => isTable(v)));
    let out = stringify(scalars).trimEnd();
    out += `${out ? '\n' : ''}developer_instructions = ${multiline(body)}\n`;
    const rest = stringify(tables).trim();
    if (rest) out += `\n${rest}\n`;
    return out;
  },
};
