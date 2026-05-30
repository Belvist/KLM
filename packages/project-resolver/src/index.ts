export type {
  KlmProjectManifest,
  ProjectFingerprint,
  ResolvedProject,
  ProjectStats,
  ProjectIdentityRow,
} from "./types.js";
export {
  ProjectNotInitializedError,
  ProjectFingerprintMismatchError,
  ProjectIdentityConflictError,
  McpWorkspaceRootError,
} from "./errors.js";
export {
  normalizeGitRemote,
  readGitRemote,
  rootPathHash,
  computeFingerprint,
  projectIdFromPath,
} from "./fingerprint.js";
export {
  KLM_DIR,
  MANIFEST_FILE,
  manifestPath,
  readManifest,
  writeManifest,
  findProjectRoot,
  defaultProjectName,
  ensureGitignoreKlm,
  countGitignoreKlmEntries,
  hasGitignoreKlm,
  findForbiddenManifestKeys,
} from "./project-config.js";
export {
  resolveMcpWorkspaceRoot,
  resolveMcpRootContext,
  assertMcpResolvable,
} from "./mcp-workspace.js";
export type { McpRootContext } from "./mcp-workspace.js";
export { ProjectsStore } from "./projects-store.js";
export {
  tenantDefaults,
  resolveProject,
  resolveForCli,
  resolveForMcp,
  ensureProjectState,
  initProject,
  resolveProjectIdForRoot,
  getProjectStats,
} from "./project-resolver.js";
export type {
  TenantDefaults,
  ResolveOptions,
  InitProjectOptions,
  InitProjectResult,
} from "./project-resolver.js";
