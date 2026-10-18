# caf

[![CI](https://github.com/common-agents/cli/actions/workflows/ci.yml/badge.svg)](https://github.com/common-agents/cli/actions/workflows/ci.yml) [![npm](https://img.shields.io/npm/v/@commonagents/cli)](https://www.npmjs.com/package/@commonagents/cli)

The reference implementation of the [Common Agent Format](https://commonagents.io). `caf` checks CAF agents against the specification and installs them into coding harnesses as their native agent files.

```bash
npm install -g @commonagents/cli
```

Or run it without installing:

```bash
npx @commonagents/cli install -t claude-code
```

Requires Node.js 22 or later. The package is on [npm](https://www.npmjs.com/package/@commonagents/cli).

## Quick start

```bash
caf init code-reviewer -d "Reviews changes for defects. Use before committing."
# edit .agents/caf/code-reviewer/AGENT.md
caf validate
caf install --harness claude-code,copilot
```

`caf install` looks for agents in `.agents/caf/` and writes, for example, `.claude/agents/code-reviewer.md` and `.github/agents/code-reviewer.agent.md`. With no `--harness`, it installs into every harness it finds set up in the project (a `.claude/` folder, `.github/agents/`, `.kiro/` and so on).

## Commands

| Command | What it does |
| --- | --- |
| `caf validate [paths...]` | Checks agents against the spec. Exits 1 if any agent has errors. |
| `caf install [paths...]` | Installs agents into harnesses. |
| `caf preview <path> -t <harness>` | Prints the agent file `caf` would write, with any warnings. |
| `caf uninstall <names...>` | Removes installed agents and the files `caf` wrote for them. |
| `caf list` | Lists agents in `.agents/caf/` and the ones installed. |
| `caf harnesses` | Lists the harnesses `caf` can install into. |
| `caf init <name>` | Creates a new agent in `.agents/caf/<name>/`. |

Paths can be an agent folder (one containing `AGENT.md`) or a folder of agents. Without paths, commands use `.agents/caf/` in the project, or `~/.agents/caf/` with `--scope user`.

### `install` options

| Option | Meaning |
| --- | --- |
| `-t, --harness <ids...>` | Harness IDs, comma-separated or repeated, or `all`. |
| `-s, --scope <scope>` | `project` (default) writes into the project; `user` writes into your home directory. |
| `-C, --project <dir>` | Project directory. Defaults to the current directory. |
| `--model-tier <[harness:]tier=model>` | Sets the model for a tier, for every harness or one. For example `strong=gpt-6.1-sol` or `codex:fast=gpt-6.1-mini`. |
| `-n, --dry-run` | Shows what would change without writing. |
| `-f, --force` | Overwrites files `caf` did not write, or that were edited since. |
| `--allow-wider-access` | Installs even when a harness cannot enforce a tool restriction. |

## Supported harnesses

| ID | Harness | Agent file (project scope) |
| --- | --- | --- |
| `claude-code` | Claude Code | `.claude/agents/<name>.md` |
| `copilot` | GitHub Copilot | `.github/agents/<name>.agent.md` |
| `codex` | Codex | `.codex/agents/<name>.toml` |
| `gemini-cli` | Gemini CLI | `.gemini/agents/<name>.md` |
| `cursor` | Cursor | `.cursor/agents/<name>.md` |
| `kiro` | Kiro | `.kiro/agents/<name>.md` |
| `antigravity` | Antigravity | `.agents/agents/<name>/agent.md` |

How each field is translated is documented in the [harness mappings](https://commonagents.io/harnesses).

## How installs behave

- **Tool restrictions are never loosened silently.** If an agent leaves out `edit`, `execute`, `web` or `agent` and the harness has no way to enforce that, `caf` stops and names the problem. Pass `--allow-wider-access` to install anyway.
- **Fields a harness cannot represent are reported** as warnings, and left out.
- **Models.** Tiers (`fast`, `balanced`, `strong`) map to each harness's models. Harnesses without a built-in table get no model unless you pass `--model-tier`.
- **Files are tracked.** Every file `caf` writes is recorded with its hash in `.agents/caf.lock.json` (or `~/.agents/caf.lock.json` for user scope). Running `install` again updates those files, deletes ones a new version no longer needs, and leaves alone any file you edited or that `caf` did not write. `--force` overrides that.
- **Support files.** Bundled skills go to the harness's skills folder. `references/` and `assets/` are copied to `<harness dir>/caf/<agent>/` (beside `agent.md` for Antigravity), and links to them in the instructions are rewritten to match.

## Using it as a library

```ts
import { loadAgent, validateAgent, getAdapter, planInstall, applyInstall } from '@commonagents/cli';

const agent = loadAgent('.agents/caf/code-reviewer');
const issues = validateAgent(agent);
const options = { scope: 'project', projectDir: process.cwd(), homeDir: os.homedir() } as const;
const plan = planInstall([agent], [getAdapter('claude-code')!], options);
if (!plan.blockers.length) applyInstall(plan, options);
```

## Development

```bash
pnpm install
pnpm test            # Vitest
pnpm run typecheck
pnpm run build       # Vite builds dist/cli.js and dist/index.js; tsc writes types
pnpm run sync-schema # copies the JSON Schema from common-agents/spec
```

## Licence

[Apache 2.0](LICENSE).
