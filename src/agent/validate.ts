import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import schema from '../schema/caf-1.0.schema.json' with { type: 'json' };
import { isKnownHarnessId } from '../harness/ids.js';
import type { Agent, Issue } from '../types.js';
import { AgentLoadError, bundledSkills, parseMarkdown } from './load.js';

// ajv-formats is CommonJS; under NodeNext its default export may be wrapped.
const addFormats = ((addFormatsModule as unknown as { default?: unknown }).default ??
  addFormatsModule) as unknown as (ajv: Ajv2020) => void;

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateSchema = ajv.compile(schema);

const KNOWN_FIELDS = new Set(Object.keys(schema.properties));
const SUPPORTED_MAJOR = 1;
const SETTINGS_FILES = ['settings.yaml', 'settings.yml', 'settings.json', 'settings.toml'];

/**
 * Checks an agent against the CAF 1.0 specification. Returns every problem
 * found; the agent is installable when no issue has level "error".
 */
export function validateAgent(agent: Agent): Issue[] {
  const issues: Issue[] = [];
  const error = (message: string) => issues.push({ level: 'error', message });
  const warn = (message: string) => issues.push({ level: 'warning', message });
  const fm = agent.frontmatter;

  if (!validateSchema(fm)) {
    for (const e of validateSchema.errors ?? []) {
      const where = e.instancePath ? e.instancePath.slice(1).replaceAll('/', '.') : 'frontmatter';
      error(`${where}: ${e.message ?? 'is invalid'}`);
    }
  }

  for (const key of Object.keys(fm)) {
    if (!KNOWN_FIELDS.has(key)) warn(`unknown field "${key}" is ignored`);
  }

  if (typeof fm.name === 'string' && fm.name !== basename(agent.dir)) {
    error(`name "${fm.name}" does not match the directory name "${basename(agent.dir)}"`);
  }

  if (typeof fm.caf === 'string') {
    const major = Number(fm.caf.split('.')[0]);
    if (major > SUPPORTED_MAJOR) error(`caf ${fm.caf} is newer than this tool supports (${SUPPORTED_MAJOR}.x)`);
  }

  if (agent.body.trim() === '') warn('the body is empty, so the agent has no instructions');

  for (const tool of [...(fm.tools ?? []), ...(fm['disallowed-tools'] ?? [])]) {
    if (typeof tool === 'string' && tool.startsWith('mcp:')) {
      const server = tool.slice(4).split('/')[0] ?? '';
      if (fm['mcp-servers'] && !(server in fm['mcp-servers'])) {
        warn(`"${tool}" refers to MCP server "${server}", which is not declared in mcp-servers`);
      }
    }
  }

  checkSkills(agent, error, warn);
  checkHarness(agent, error, warn);
  return issues;
}

function checkSkills(agent: Agent, error: (m: string) => void, warn: (m: string) => void) {
  const listed = new Set(agent.frontmatter.skills ?? []);
  const bundled = bundledSkills(agent);
  for (const name of bundled) {
    const file = join(agent.dir, 'skills', name, 'SKILL.md');
    try {
      const { data } = parseMarkdown(readFileSync(file, 'utf8'), file);
      const skillName = (data as { name?: unknown }).name;
      if (skillName !== name) error(`skills/${name}/SKILL.md has name "${String(skillName)}", expected "${name}"`);
    } catch (err) {
      error(err instanceof AgentLoadError ? err.message : String(err));
    }
    if (!listed.has(name)) warn(`skill "${name}" is bundled but not listed in skills, so it will not be preloaded`);
  }
  for (const name of listed) {
    if (!bundled.includes(name)) {
      warn(`skill "${name}" is not bundled in skills/, so it must already be installed in the harness`);
    }
  }
}

function checkHarness(agent: Agent, error: (m: string) => void, warn: (m: string) => void) {
  const entries = agent.frontmatter.harness ?? {};
  for (const [id, entry] of Object.entries(entries)) {
    if (!isKnownHarnessId(id)) warn(`harness "${id}" is not a registered harness ID or a reverse-domain name`);
    if (entry?.path !== undefined && !isDir(join(agent.dir, entry.path))) {
      error(`harness.${id}.path "${entry.path}" is not a directory`);
    }
  }

  const harnessRoot = join(agent.dir, 'harness');
  const dirs = new Map<string, string>();
  if (isDir(harnessRoot)) {
    for (const e of readdirSync(harnessRoot, { withFileTypes: true })) {
      if (e.isDirectory()) dirs.set(e.name, join(harnessRoot, e.name));
    }
  }
  for (const [id, entry] of Object.entries(entries)) {
    if (entry?.path !== undefined) dirs.set(id, join(agent.dir, entry.path));
  }
  for (const [id, dir] of dirs) {
    if (!isKnownHarnessId(id)) warn(`harness/${id}/ is not a registered harness ID or a reverse-domain name`);
    if (!isDir(dir)) continue;
    const settings = SETTINGS_FILES.filter((f) => existsSync(join(dir, f)));
    if (settings.length > 1) error(`harness/${id}/ has more than one settings file: ${settings.join(', ')}`);
  }
}

function isDir(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory();
}
