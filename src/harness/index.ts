import type { HarnessAdapter } from '../render.js';
import { antigravity } from './antigravity.js';
import { claudeCode } from './claude-code.js';
import { codex } from './codex.js';
import { copilot } from './copilot.js';
import { cursor } from './cursor.js';
import { geminiCli } from './gemini-cli.js';
import { kiro } from './kiro.js';

/** Harnesses this tool can install into. */
export const ADAPTERS: readonly HarnessAdapter[] = [claudeCode, copilot, codex, geminiCli, cursor, kiro, antigravity];

export function getAdapter(id: string): HarnessAdapter | undefined {
  return ADAPTERS.find((a) => a.id === id);
}

/**
 * Directories whose presence in a project suggests the harness is in use.
 * A harness is detected when any of its markers exists.
 */
export const DETECTION_MARKERS: Record<string, string[]> = {
  'claude-code': ['.claude', 'CLAUDE.md'],
  copilot: ['.github/agents', '.github/copilot-instructions.md'],
  codex: ['.codex'],
  'gemini-cli': ['.gemini', 'GEMINI.md'],
  cursor: ['.cursor'],
  kiro: ['.kiro'],
  antigravity: ['.agents/agents'],
};
