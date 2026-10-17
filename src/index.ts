// Library entry point, for tools that build on the reference implementation.
export { AGENT_FILE, AgentLoadError, bundledSkills, findAgentDirs, loadAgent, parseMarkdown } from './agent/load.js';
export { validateAgent } from './agent/validate.js';
export { ADAPTERS, DETECTION_MARKERS, getAdapter } from './harness/index.js';
export { REGISTERED_HARNESS_IDS, isKnownHarnessId } from './harness/ids.js';
export {
  applyInstall,
  lockPath,
  lockRoot,
  planInstall,
  readLock,
  uninstall,
  type FileAction,
  type FileChange,
  type InstallOptions,
  type InstallPlan,
  type LockEntry,
  type LockFile,
  type UninstallOptions,
} from './install.js';
export {
  deepMerge,
  renderAgent,
  resolveModel,
  rewriteLinks,
  type DeriveInput,
  type HarnessAdapter,
  type HarnessPaths,
  type PlannedFile,
  type RenderOptions,
  type RenderResult,
} from './render.js';
export { resolveToolPolicy, type ToolPolicy } from './tools.js';
export { runCli, type CliIO } from './cli.js';
export * from './types.js';
