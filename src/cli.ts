import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { Command, CommanderError, Option } from 'commander';
import { findAgentDirs, loadAgent } from './agent/load.js';
import { validateAgent } from './agent/validate.js';
import { ADAPTERS, DETECTION_MARKERS, getAdapter } from './harness/index.js';
import { REGISTERED_HARNESS_IDS } from './harness/ids.js';
import { applyInstall, lockRoot, planInstall, readLock, uninstall, type FileChange } from './install.js';
import { renderAgent, type HarnessAdapter } from './render.js';
import { MODEL_TIERS, type Agent, type ModelTier, type Scope } from './types.js';

declare const __CAF_CLI_VERSION__: string;
const VERSION = typeof __CAF_CLI_VERSION__ === 'string' ? __CAF_CLI_VERSION__ : '0.0.0-dev';

export interface CliIO {
  out: (text: string) => void;
  err: (text: string) => void;
  cwd: string;
  homeDir: string;
}

class UsageError extends Error {}

const AGENT_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Runs the CLI with the given arguments (excluding node and script). Returns the exit code. */
export async function runCli(argv: string[], io: CliIO): Promise<number> {
  const line = (text = '') => io.out(`${text}\n`);
  const errLine = (text: string) => io.err(`${text}\n`);
  let exitCode = 0;

  const program = new Command('caf')
    .description('Validate Common Agent Format agents and install them into coding harnesses.')
    .version(VERSION, '-v, --version')
    .exitOverride()
    .configureOutput({ writeOut: io.out, writeErr: io.err })
    .showHelpAfterError();

  const scopeOption = () =>
    new Option('-s, --scope <scope>', 'install for this project or for your user').choices(['project', 'user']).default('project');
  const projectOption = () => new Option('-C, --project <dir>', 'project directory').default(io.cwd);

  const defaultAgentsDir = (scope: Scope, projectDir: string) =>
    scope === 'project' ? join(projectDir, '.agents', 'caf') : join(io.homeDir, '.agents', 'caf');

  const loadAgents = (paths: string[], scope: Scope, projectDir: string): Agent[] => {
    const dirs = paths.length ? paths.map((p) => resolve(io.cwd, p)) : [defaultAgentsDir(scope, projectDir)];
    if (!paths.length && !existsSync(dirs[0]!)) {
      throw new UsageError(`no agents given and ${dirs[0]} does not exist`);
    }
    const found = findAgentDirs(dirs);
    if (!found.length) throw new UsageError(`no CAF agents (folders containing AGENT.md) found in ${dirs.join(', ')}`);
    return found.map(loadAgent);
  };

  const resolveHarnesses = (ids: string[] | undefined, projectDir: string): HarnessAdapter[] => {
    const list = (ids ?? []).flatMap((s) => s.split(',')).map((s) => s.trim()).filter(Boolean);
    if (list.includes('all')) return [...ADAPTERS];
    if (!list.length) {
      const detected = ADAPTERS.filter((a) => (DETECTION_MARKERS[a.id] ?? []).some((m) => existsSync(join(projectDir, m))));
      if (!detected.length) {
        throw new UsageError(`no harness found in ${projectDir}; choose one with --harness (${ADAPTERS.map((a) => a.id).join(', ')}, or all)`);
      }
      return detected;
    }
    return list.map((id) => {
      const adapter = getAdapter(id);
      if (adapter) return adapter;
      if ((REGISTERED_HARNESS_IDS as readonly string[]).includes(id)) {
        throw new UsageError(`harness "${id}" is registered in the spec but has no mapping yet, so caf cannot install into it`);
      }
      throw new UsageError(`unknown harness "${id}"; known harnesses: ${ADAPTERS.map((a) => a.id).join(', ')}`);
    });
  };

  /**
   * Parses --model-tier values of the form [harness:]tier=model. Entries
   * without a harness apply to every harness; harness-specific entries win.
   */
  const parseTiers = (values: string[] | undefined): Record<string, Partial<Record<ModelTier, string>>> => {
    const out: Record<string, Partial<Record<ModelTier, string>>> = {};
    for (const v of values ?? []) {
      const m = v.match(/^(?:([a-z0-9.-]+):)?([a-z]+)=(.+)$/);
      const tier = m?.[2];
      if (!m || !tier || !(MODEL_TIERS as readonly string[]).includes(tier)) {
        throw new UsageError(`--model-tier expects [harness:]<tier>=<model> with tier one of ${MODEL_TIERS.join(', ')}; got "${v}"`);
      }
      const key = m[1] ?? '*';
      out[key] = { ...out[key], [tier]: m[3] };
    }
    return out;
  };
  /** Validates agents and prints problems; returns false if any agent has errors. */
  const checkAgents = (agents: Agent[], quiet = false): boolean => {
    let ok = true;
    for (const agent of agents) {
      const issues = validateAgent(agent);
      const errors = issues.filter((i) => i.level === 'error');
      if (errors.length) ok = false;
      if (quiet && !issues.length) continue;
      line(`${errors.length ? 'FAIL' : 'ok  '}  ${displayDir(agent.dir)}`);
      for (const i of issues) line(`      ${i.level === 'error' ? 'error' : 'warn '}  ${i.message}`);
    }
    return ok;
  };

  const displayDir = (abs: string) => {
    const rel = relative(io.cwd, abs);
    return rel && !rel.startsWith('..') ? rel : abs;
  };

  const printChanges = (changes: FileChange[], root: string, dryRun: boolean) => {
    const verbs: Record<FileChange['action'], string> = dryRun
      ? { create: 'would create', update: 'would update', unchanged: 'unchanged', conflict: 'would overwrite', delete: 'would delete', 'keep-modified': 'would keep (edited)' }
      : { create: 'created', update: 'updated', unchanged: 'unchanged', conflict: 'overwrote', delete: 'deleted', 'keep-modified': 'kept (edited)' };
    for (const c of changes) line(`  ${verbs[c.action].padEnd(18)} ${displayDir(join(root, c.path))}`);
  };

  program
    .command('validate')
    .description('check CAF agents against the specification')
    .argument('[paths...]', 'agent folders, or folders containing agents (default: .agents/caf)')
    .addOption(projectOption())
    .action((paths: string[], opts: { project: string }) => {
      const agents = loadAgents(paths, 'project', resolve(io.cwd, opts.project));
      if (!checkAgents(agents)) exitCode = 1;
    });

  program
    .command('install')
    .description('install CAF agents into one or more harnesses')
    .argument('[paths...]', 'agent folders, or folders containing agents (default: .agents/caf)')
    .option('-t, --harness <ids...>', 'harness IDs, comma-separated or repeated, or "all" (default: detect from the project)')
    .addOption(scopeOption())
    .addOption(projectOption())
    .option('--model-tier <tier=model...>', 'map a model tier to a model, for all harnesses (strong=<model>) or one (codex:strong=<model>)')
    .option('-n, --dry-run', 'show what would change without writing anything')
    .option('-f, --force', 'overwrite files that caf did not write or that were edited since')
    .option('--allow-wider-access', 'install even when a harness cannot enforce a tool restriction')
    .action((paths: string[], opts: { harness?: string[]; scope: Scope; project: string; modelTier?: string[]; dryRun?: boolean; force?: boolean; allowWiderAccess?: boolean }) => {
      const projectDir = resolve(io.cwd, opts.project);
      const agents = loadAgents(paths, opts.scope, projectDir);
      if (!checkAgents(agents, true)) {
        errLine('Not installing: fix the errors above first.');
        exitCode = 1;
        return;
      }
      const adapters = resolveHarnesses(opts.harness, projectDir);
      const options = {
        scope: opts.scope,
        projectDir,
        homeDir: io.homeDir,
        modelTiers: parseTiers(opts.modelTier),
        dryRun: opts.dryRun,
        force: opts.force,
        allowWiderAccess: opts.allowWiderAccess,
      };
      const plan = planInstall(agents, adapters, options);
      for (const r of plan.results) {
        line(`${r.harness}/${r.agent}${r.skipped ? ': skipped (disabled in harness settings)' : ''}`);
        for (const w of r.warnings) line(`  warn  ${w}`);
        if (opts.allowWiderAccess) for (const x of r.refusals) line(`  warn  wider access accepted: ${x}`);
      }
      const root = lockRoot(options.scope, projectDir, io.homeDir);
      if (plan.blockers.length) {
        errLine('\nNot installing:');
        for (const b of plan.blockers) errLine(`  ${b}`);
        if (plan.blockers.some((b) => !b.includes('--force'))) {
          errLine('Pass --allow-wider-access to install with the wider access, or choose other harnesses.');
        }
        exitCode = 1;
        return;
      }
      line();
      printChanges(plan.changes, root, Boolean(opts.dryRun));
      if (!opts.dryRun) applyInstall(plan, options);
    });

  program
    .command('preview')
    .description('print the agent file caf would write for one harness')
    .argument('<path>', 'agent folder')
    .requiredOption('-t, --harness <id>', 'harness ID')
    .addOption(scopeOption())
    .addOption(projectOption())
    .option('--model-tier <tier=model...>', 'map a model tier to a model')
    .action((path: string, opts: { harness: string; scope: Scope; project: string; modelTier?: string[] }) => {
      const agent = loadAgent(resolve(io.cwd, path));
      const [adapter] = resolveHarnesses([opts.harness], io.cwd);
      const result = renderAgent(agent, adapter!, {
        scope: opts.scope,
        projectDir: resolve(io.cwd, opts.project),
        homeDir: io.homeDir,
        modelTiers: parseTiers(opts.modelTier),
      });
      if (result.skipped) {
        line(`${agent.frontmatter.name} is disabled for ${adapter!.id} in its harness settings.`);
        return;
      }
      const main = result.files.find((f) => f.kind === 'agent')!;
      line(`# ${displayDir(main.path)}`);
      io.out(main.content.toString());
      for (const w of result.warnings) errLine(`warn  ${w}`);
      for (const r of result.refusals) errLine(`refuse  ${r}`);
    });

  program
    .command('uninstall')
    .description('remove installed agents and the files caf wrote for them')
    .argument('<names...>', 'agent names')
    .option('-t, --harness <ids...>', 'only remove from these harnesses')
    .addOption(scopeOption())
    .addOption(projectOption())
    .option('-n, --dry-run', 'show what would be removed')
    .action((names: string[], opts: { harness?: string[]; scope: Scope; project: string; dryRun?: boolean }) => {
      const projectDir = resolve(io.cwd, opts.project);
      const harnesses = opts.harness?.flatMap((s) => s.split(','));
      const { removed, changes } = uninstall(names, { scope: opts.scope, projectDir, homeDir: io.homeDir, harnesses, dryRun: opts.dryRun });
      if (!removed.length) {
        errLine(`Nothing to remove: ${names.join(', ')} ${names.length > 1 ? 'are' : 'is'} not installed in this scope.`);
        exitCode = 1;
        return;
      }
      for (const key of removed) line(`${opts.dryRun ? 'would remove' : 'removed'} ${key}`);
      printChanges(changes, lockRoot(opts.scope, projectDir, io.homeDir), Boolean(opts.dryRun));
    });

  program
    .command('list')
    .description('list available and installed agents')
    .addOption(scopeOption())
    .addOption(projectOption())
    .action((opts: { scope: Scope; project: string }) => {
      const projectDir = resolve(io.cwd, opts.project);
      const dir = defaultAgentsDir(opts.scope, projectDir);
      line(`Available in ${displayDir(dir)}:`);
      const available = existsSync(dir) ? findAgentDirs([dir]) : [];
      if (!available.length) line('  (none)');
      for (const d of available) {
        const a = loadAgent(d);
        line(`  ${a.frontmatter.name}${a.frontmatter.version ? ` ${a.frontmatter.version}` : ''}`);
      }
      const lock = readLock(lockRoot(opts.scope, projectDir, io.homeDir));
      line('Installed:');
      const entries = Object.values(lock.installs);
      if (!entries.length) line('  (none)');
      for (const e of entries) line(`  ${e.agent}${e.agentVersion ? ` ${e.agentVersion}` : ''} → ${e.harness}`);
    });

  program
    .command('harnesses')
    .description('list the harnesses caf can install into')
    .action(() => {
      for (const a of ADAPTERS) line(`${a.id.padEnd(13)} ${a.name}`);
      const unmapped = REGISTERED_HARNESS_IDS.filter((id) => !getAdapter(id));
      if (unmapped.length) line(`\nRegistered but not yet supported: ${unmapped.join(', ')}`);
    });

  program
    .command('init')
    .description('create a new CAF agent')
    .argument('<name>', 'agent name: lowercase letters, digits and hyphens')
    .option('-d, --description <text>', 'what the agent does and when to use it')
    .option('--dir <dir>', 'folder to create the agent in (default: .agents/caf)')
    .addOption(projectOption())
    .action((name: string, opts: { description?: string; dir?: string; project: string }) => {
      if (!AGENT_NAME.test(name) || name.length > 64) {
        throw new UsageError(`"${name}" is not a valid agent name: use lowercase letters, digits and single hyphens`);
      }
      const parent = opts.dir ? resolve(io.cwd, opts.dir) : defaultAgentsDir('project', resolve(io.cwd, opts.project));
      const dir = join(parent, name);
      if (existsSync(dir)) throw new UsageError(`${displayDir(dir)} already exists`);
      mkdirSync(dir, { recursive: true });
      const description = opts.description ?? 'Describe what this agent does and when it should be used.';
      writeFileSync(
        join(dir, 'AGENT.md'),
        `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\ncaf: "1.0"\nmodel: inherit\n---\n\nYou are ...\n\n## Scope\n\n## Method\n\n## Output\n`,
      );
      line(`Created ${displayDir(join(dir, 'AGENT.md'))}`);
    });

  try {
    await program.parseAsync(argv, { from: 'user' });
  } catch (err) {
    if (err instanceof CommanderError) {
      return err.code === 'commander.helpDisplayed' || err.code === 'commander.version' || err.exitCode === 0 ? 0 : err.exitCode || 1;
    }
    errLine(`error: ${(err as Error).message}`);
    return err instanceof UsageError ? 2 : 1;
  }
  return exitCode;
}
