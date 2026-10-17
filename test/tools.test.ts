import { describe, expect, it } from 'vitest';
import { allowedMcp, deniedAdvisory, deniedBinding, resolveToolPolicy } from '../src/tools.js';
import type { Frontmatter } from '../src/types.js';

const fm = (extra: Partial<Frontmatter>): Frontmatter => ({ name: 'a', description: 'd', ...extra });

describe('resolveToolPolicy', () => {
  it('allows everything when tools is absent', () => {
    const p = resolveToolPolicy(fm({}));
    expect(p.restricted).toBe(false);
    expect(p.capabilities.size).toBe(7);
    expect(p.mcpAll).toBe(true);
  });

  it('treats "*" as no restriction', () => {
    expect(resolveToolPolicy(fm({ tools: ['*'] })).restricted).toBe(false);
  });

  it('limits to the listed capabilities and MCP entries', () => {
    const p = resolveToolPolicy(fm({ tools: ['read', 'mcp:github', 'mcp:jira/search'] }));
    expect([...p.capabilities]).toEqual(['read']);
    expect(p.mcpAll).toBe(false);
    expect(p.mcpAllowed.get('github')).toBe('*');
    expect(p.mcpAllowed.get('jira')).toEqual(new Set(['search']));
  });

  it('applies disallowed-tools after tools', () => {
    const p = resolveToolPolicy(fm({ tools: ['read', 'edit', 'mcp:github'], 'disallowed-tools': ['edit', 'mcp:github'] }));
    expect([...p.capabilities]).toEqual(['read']);
    expect(p.mcpAllowed.has('github')).toBe(false);
  });

  it('splits denied capabilities into binding and advisory', () => {
    const p = resolveToolPolicy(fm({ tools: ['read', 'execute'] }));
    expect(deniedBinding(p)).toEqual(['edit', 'web', 'agent']);
    expect(deniedAdvisory(p)).toEqual(['search', 'todo']);
  });

  it('lists declared MCP servers as allowed unless denied', () => {
    const p = resolveToolPolicy(fm({ 'disallowed-tools': ['mcp:b'] }));
    expect([...allowedMcp(p, ['a', 'b']).keys()]).toEqual(['a']);
  });
});
