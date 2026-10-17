/** Harness IDs registered in the CAF specification. */
export const REGISTERED_HARNESS_IDS = [
  'claude-code',
  'copilot',
  'codex',
  'gemini-cli',
  'cursor',
  'kiro',
  'antigravity',
  'opencode',
  'grok',
  'kilo',
] as const;

/** Reverse-domain IDs (com.example.harness) are allowed for unregistered harnesses. */
export const REVERSE_DOMAIN_ID = /^[a-z0-9]+(\.[a-z0-9-]+){2,}$/;

export function isKnownHarnessId(id: string): boolean {
  return (REGISTERED_HARNESS_IDS as readonly string[]).includes(id) || REVERSE_DOMAIN_ID.test(id);
}
