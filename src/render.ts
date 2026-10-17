import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import YAML from 'yaml';
import { bundledSkills } from './agent/load.js';
import { resolveToolPolicy, type ToolPolicy } from './tools.js';
import { MODEL_TIERS, type Agent, type ModelTier, type Scope } from './types.js';

/** Where a harness keeps the files generated for one agent. */
export interface HarnessPaths {
  /** The agent definition file. */
  agentFile: string;
  /** Root that harness/<id>/files/ is copied into. */
  configDir: string;
  /** Directory that bundled skills are copied into, one subdirectory per skill. */
  skillsDir: string;
  /** Directory that references/ and assets/ are copied into. */
  supportDir: string;
}

export interface RenderOptions {
  scope: Scope;
  projectDir: string;
  homeDir: string;
  /**
   * Overrides for harness model tier tables, keyed by harness ID, with "*"
   * applying to every harness. Harness-specific entries win.
   */
  modelTiers?: Record<string, Partial<Record<ModelTier, string>>>;
}

/** Input an adapter uses to derive native fields. */
export interface DeriveInput {
  agent: Agent;
  policy: ToolPolicy;
  paths: HarnessPaths;
  /** Skills bundled in the agent's skills/ directory. */
  bundledSkills: string[];
  /** Model value for the harness, already resolved from tiers; undefined leaves it unset. */
  model: string | undefined;
  /** Turns an absolute path into the form an agent should use to refer to it. */
  displayPath: (abs: string) => string;
  warn: (message: string) => void;
  refuse: (message: string) => void;
}

export interface HarnessAdapter {
  id: string;
  name: string;
  /** Default model per tier; a missing tier leaves the model unset with a warning. */
  modelTiers: Partial<Record<ModelTier, string>>;
  paths(agentName: string, scope: Scope, projectDir: string, homeDir: string): HarnessPaths;
  /** Native fields derived from the portable CAF fields. */
  derive(input: DeriveInput): Record<string, unknown>;
  /** Writes the agent file from merged native fields and the instructions body. */
  serialize(fields: Record<string, unknown>, body: string): string;
}

export interface PlannedFile {
  /** Absolute destination path. */
  path: string;
  content: Buffer;
  /** File mode copied from the source, for executable scripts. */
  mode?: number;
  kind: 'agent' | 'skill' | 'support' | 'harness-file';
}

export interface RenderResult {
  harness: string;
  agent: string;
  agentVersion?: string;
  /** True when harness.<id>.enabled is false. */
  skipped: boolean;
  files: PlannedFile[];
  warnings: string[];
  /** Binding restrictions the harness cannot enforce. */
  refusals: string[];
}

const SETTINGS_FILES = ['settings.yaml', 'settings.yml', 'settings.json', 'settings.toml'];
const REPLACE_MARKER = /^<!--\s*caf:replace\s*-->[ \t]*\r?\n?/;

/**
 * Produces every file needed to install `agent` into the harness, without
 * writing anything. Settings are merged in spec order: derived fields, then
 * the harness directory's settings file, then harness.<id>.settings.
 */
export function renderAgent(agent: Agent, adapter: HarnessAdapter, options: RenderOptions): RenderResult {
  const fm = agent.frontmatter;
  const result: RenderResult = {
    harness: adapter.id,
    agent: fm.name,
    ...(fm.version ? { agentVersion: fm.version } : {}),
    skipped: false,
    files: [],
    warnings: [],
    refusals: [],
  };
  const entry = fm.harness?.[adapter.id];
  if (entry?.enabled === false) {
    result.skipped = true;
    return result;
  }

  const paths = adapter.paths(fm.name, options.scope, options.projectDir, options.homeDir);
  const displayPath = (abs: string) =>
    options.scope === 'project' ? toPosix(relative(options.projectDir, abs)) : toPosix(abs);
  const harnessDir = join(agent.dir, entry?.path ?? join('harness', adapter.id));

  const warn = (m: string) => result.warnings.push(m);
  const tiers = { ...adapter.modelTiers, ...options.modelTiers?.['*'], ...options.modelTiers?.[adapter.id] };
  const model = resolveModel(fm.model, tiers, adapter.name, warn);
  const skills = bundledSkills(agent);

  const derived = adapter.derive({
    agent,
    policy: resolveToolPolicy(fm),
    paths,
    bundledSkills: skills,
    model,
    displayPath,
    warn,
    refuse: (m) => result.refusals.push(m),
  });
  const fields = deepMerge(deepMerge(derived, readSettingsFile(harnessDir)), entry?.settings ?? {});

  let body = agent.body;
  const extra = join(harnessDir, 'instructions.md');
  if (existsSync(extra)) {
    const text = readFileSync(extra, 'utf8');
    body = REPLACE_MARKER.test(text) ? text.replace(REPLACE_MARKER, '') : `${body.trimEnd()}\n\n${text}`;
  }
  body = rewriteLinks(body, displayPath(paths.supportDir), displayPath(paths.skillsDir));
  if (!body.endsWith('\n')) body += '\n';

  result.files.push({
    path: paths.agentFile,
    content: Buffer.from(adapter.serialize(fields, body)),
    kind: 'agent',
  });
  for (const skill of skills) {
    result.files.push(...copyTree(join(agent.dir, 'skills', skill), join(paths.skillsDir, skill), 'skill'));
  }
  for (const dir of ['references', 'assets']) {
    result.files.push(...copyTree(join(agent.dir, dir), join(paths.supportDir, dir), 'support'));
  }
  result.files.push(...copyTree(join(harnessDir, 'files'), paths.configDir, 'harness-file'));
  return result;
}

/**
 * Resolves `model` against a tier table. Tiers missing from the table
 * resolve to undefined, with a warning unless the tier is "inherit".
 */
export function resolveModel(
  model: string | undefined,
  tiers: Partial<Record<ModelTier, string>>,
  harnessName: string,
  warn: (m: string) => void,
): string | undefined {
  const value = model ?? 'inherit';
  if (!(MODEL_TIERS as readonly string[]).includes(value)) return value;
  const mapped = tiers[value as ModelTier];
  if (mapped === undefined && value !== 'inherit') {
    warn(`model tier "${value}" has no mapping for ${harnessName}, so no model is set; pass --model-tier ${value}=<model> to set one`);
  }
  return mapped;
}

/** Rewrites links to references/, assets/ and skills/ so they resolve after installation. */
export function rewriteLinks(body: string, supportRef: string, skillsRef: string): string {
  return body.replace(/(\]\()(?:\.\/)?((references|assets|skills)\/[^)\s]*)/g, (_m, open: string, path: string, root: string) => {
    const target = root === 'skills' ? `${skillsRef}/${path.slice('skills/'.length)}` : `${supportRef}/${path}`;
    return `${open}${target}`;
  });
}

/** Merges plain objects key by key; arrays and other values from `over` replace those in `base`. */
export function deepMerge(base: Record<string, unknown>, over: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(over)) {
    const current = out[key];
    out[key] = isPlainObject(current) && isPlainObject(value) ? deepMerge(current, value) : value;
  }
  return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readSettingsFile(dir: string): Record<string, unknown> {
  for (const name of SETTINGS_FILES) {
    const file = join(dir, name);
    if (!existsSync(file)) continue;
    const text = readFileSync(file, 'utf8');
    const data: unknown = name.endsWith('.toml') ? parseToml(text) : name.endsWith('.json') ? JSON.parse(text) : YAML.parse(text);
    if (data === null || data === undefined) return {};
    if (!isPlainObject(data)) throw new Error(`${file}: settings must be a mapping`);
    return data;
  }
  return {};
}

function copyTree(src: string, dest: string, kind: PlannedFile['kind']): PlannedFile[] {
  if (!existsSync(src) || !statSync(src).isDirectory()) return [];
  const out: PlannedFile[] = [];
  for (const entry of readdirSync(src, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const from = join(entry.parentPath, entry.name);
    out.push({
      path: join(dest, relative(src, from)),
      content: readFileSync(from),
      mode: statSync(from).mode & 0o777,
      kind,
    });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

export function toPosix(path: string): string {
  return path.split(sep).join('/');
}

/** Serializes YAML frontmatter followed by a Markdown body. */
export function markdownWithFrontmatter(fields: Record<string, unknown>, body: string): string {
  const clean = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
  const yaml = YAML.stringify(clean, { lineWidth: 0 }).trimEnd();
  return `---\n${yaml}\n---\n\n${body}`;
}
