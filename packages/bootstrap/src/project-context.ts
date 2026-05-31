import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  getProjectStats,
  initProject,
  readManifest,
  resolveForCli,
  resolveForMcp,
  writeManifest,
  type KlmProjectManifest,
  type ResolvedProject,
} from "@klm/project-resolver";

export type { KlmProjectManifest, ResolvedProject };
export {
  projectIdFromPath,
  readManifest,
  writeManifest,
  findProjectRoot,
} from "@klm/project-resolver";
export { manifestPath } from "@klm/project-resolver";

export interface ResolvedProjectContext {
  manifest: KlmProjectManifest;
  tenant: ResolvedProject["tenant"];
  indexStats: {
    files: number;
    routes: number;
    symbols: number;
  };
  registered: boolean;
  indexed: boolean;
}

export interface ResolveProjectOptions {
  /** Explicit project UUID (overrides manifest). */
  projectId?: string;
  /** @deprecated No silent manifest creation — use klm:init. */
  writeManifest?: boolean;
  /** Insert minimal project_states row if missing. Requires DATABASE_URL. */
  autoRegister?: boolean;
  /** MCP mode: walk up to find .klm/project.json, allow env fallback. */
  mcp?: boolean;
}

/**
 * Resolve which KLM project maps to an opened workspace folder.
 * Source of truth: .klm/project.json (created by klm:init).
 */
export async function resolveProjectContext(
  workspaceRoot: string,
  options: ResolveProjectOptions = {}
): Promise<ResolvedProjectContext> {
  const root = resolve(workspaceRoot);
  const autoRegister = options.autoRegister !== false;

  const resolved = options.mcp
    ? resolveForMcp(process.cwd(), process.env.KLM_PROJECT_ID)
    : resolveForCli(root, options.projectId);

  const tenant = resolved.tenant;
  let registered = false;
  let indexStats = { files: 0, routes: 0, symbols: 0 };

  const connectionString = process.env.DATABASE_URL;
  if (connectionString) {
    if (autoRegister) {
      const init = await initProject({
        root: resolved.manifest.rootPath,
        projectId: resolved.manifest.projectId,
        connectionString,
        tenant,
      });
      registered = init.stateCreated;
    }
    const stats = await getProjectStats(connectionString, resolved.manifest.projectId);
    indexStats = {
      files: stats.files,
      routes: stats.routes,
      symbols: stats.symbols,
    };
  }

  return {
    manifest: resolved.manifest,
    tenant,
    indexStats,
    registered,
    indexed: indexStats.files > 0,
  };
}

/** Dev helper: pin an existing UUID to a repo (e.g. migrate music-platform). */
export function pinProjectId(
  workspaceRoot: string,
  projectId: string,
  name?: string
): KlmProjectManifest {
  const root = resolve(workspaceRoot);
  const existing = readManifest(root);
  const manifest: KlmProjectManifest = {
    projectId,
    name: name ?? existing?.name ?? root.split(/[/\\]/).pop() ?? "project",
    rootPath: root,
    rootFingerprint: existing?.rootFingerprint ?? `pinned:${projectId}`,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    organizationId:
      existing?.organizationId ??
      process.env.KLM_ORGANIZATION_ID ??
      "00000000-0000-4000-8000-000000000001",
    workspaceId:
      existing?.workspaceId ??
      process.env.KLM_WORKSPACE_ID ??
      "00000000-0000-4000-8000-000000000002",
    userId: existing?.userId ?? process.env.KLM_USER_ID ?? "00000000-0000-4000-8000-000000000004",
  };
  writeManifest(root, manifest);
  return manifest;
}

export function newRequestId(): string {
  return randomUUID();
}
