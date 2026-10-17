import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli } from '../src/cli.js';
import { loadAgent } from '../src/agent/load.js';
import type { Agent } from '../src/types.js';

export const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

/** A temporary project and home directory. */
export function tempWorkspace() {
  const root = mkdtempSync(join(tmpdir(), 'caf-test-'));
  const project = join(root, 'project');
  const home = join(root, 'home');
  mkdirSync(project, { recursive: true });
  mkdirSync(home, { recursive: true });
  return { root, project, home };
}

/** Copies the example agents into <project>/.agents/caf/. */
export function withFixtures(project: string) {
  const dest = join(project, '.agents', 'caf');
  cpSync(FIXTURES, dest, { recursive: true });
  return dest;
}

/** Writes files (path → content) under dir. */
export function writeTree(dir: string, files: Record<string, string>) {
  for (const [path, content] of Object.entries(files)) {
    const abs = join(dir, path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
}

/** Creates an agent folder from frontmatter YAML and body, and loads it. */
export function makeAgent(parent: string, name: string, frontmatter: string, body = 'Do the task.\n', extra: Record<string, string> = {}): Agent {
  writeTree(join(parent, name), { 'AGENT.md': `---\nname: ${name}\n${frontmatter}\n---\n\n${body}`, ...extra });
  return loadAgent(join(parent, name));
}

export async function cli(args: string[], cwd: string, home: string) {
  let out = '';
  let err = '';
  const code = await runCli(args, { out: (t) => (out += t), err: (t) => (err += t), cwd, homeDir: home });
  return { code, out, err };
}
