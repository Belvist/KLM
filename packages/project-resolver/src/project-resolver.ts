import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { ProjectStateSchema } from "@klm/core";
import type { KlmProjectManifest, ProjectFingerprint, ResolvedProject } from "./types.js";
import {
  ProjectFingerprintMismatchError,
  ProjectIdentityConflictError,
  ProjectNotInitializedError,
} from "./errors.js";
import { computeFingerprint } from "./fingerprint.js";
import {
  assertMcpResolvable,
  resolveMcpRootContext,
} from "./mcp-workspace.js";
import {
  defaultProjectName,
  ensureGitignoreKlm,
  findProjectRoot,
  readManifest,
  writeManifest,
} from "./project-config.js";
import { ProjectsStore } from "./projects-store.js";

export interface TenantDefaults {
  organizationId: string;
  workspaceId: string;
  userId: string;
}

export function tenantDefaults(): TenantDefaults {
  return {
    organizationId: process.env.KLM_ORGANIZATION_ID ?? "00000000-0000-4000-8000-000000000001",
    workspaceId: process.env.KLM_WORKSPACE_ID ?? "00000000-0000-4000-8000-000000000002",
    userId: process.env.KLM_USER_ID ?? "00000000-0000-4000-8000-000000000004",
  };
}

export interface ResolveOptions {
  projectId?: string;
  headerProjectId?: string;
  envProjectId?: string;
  walkUp?: boolean;
}

function manifestToResolved(manifest: KlmProjectManifest, source: ResolvedProject["source"]): ResolvedProject {
  const defaults = tenantDefaults();
  return {
    manifest,
    tenant: {
      organizationId: manifest.organizationId ?? defaults.organizationId,
      workspaceId: manifest.workspaceId ?? defaults.workspaceId,
      userId: manifest.userId ?? defaults.userId,
    },
    source,
  };
}

function manifestFromEnv(envProjectId: string, root: string): KlmProjectManifest {
  const tenant = tenantDefaults();
  return {
    projectId: envProjectId,
    name: defaultProjectName(root),
    rootPath: root,
    rootFingerprint: `env:${envProjectId}`,
    createdAt: new Date().toISOString(),
    organizationId: tenant.organizationId,
    workspaceId: tenant.workspaceId,
    userId: tenant.userId,
  };
}

function locateManifest(startDir: string, walkUp: boolean): { root: string; manifest: KlmProjectManifest | null } {
  const absStart = resolve(startDir);
  const direct = readManifest(absStart);
  if (direct) return { root: absStart, manifest: direct };

  if (walkUp) {
    const found = findProjectRoot(absStart);
    if (found) return { root: found, manifest: readManifest(found) };
  }

  return { root: absStart, manifest: null };
}

export function resolveProject(startDir: string, options: ResolveOptions = {}): ResolvedProject {
  const { root, manifest } = locateManifest(startDir, options.walkUp === true);

  if (options.projectId) {
    if (manifest && manifest.projectId !== options.projectId) {
      return manifestToResolved(
        { ...manifest, projectId: options.projectId, rootPath: root },
        "explicit-cli"
      );
    }
    if (manifest) return manifestToResolved(manifest, "explicit-cli");
    throw new ProjectNotInitializedError(root);
  }

  if (options.headerProjectId) {
    if (!manifest) throw new ProjectNotInitializedError(root);
    if (manifest.projectId !== options.headerProjectId) {
      throw new Error(
        `X-KLM-Project-Id ${options.headerProjectId} does not match .klm/project.json ${manifest.projectId}`
      );
    }
    return manifestToResolved(manifest, "header");
  }

  if (manifest) {
    return manifestToResolved(manifest, "manifest");
  }

  if (options.envProjectId) {
    return manifestToResolved(manifestFromEnv(options.envProjectId, root), "env-fallback");
  }

  throw new ProjectNotInitializedError(root);
}

export function resolveForCli(root: string, explicitProjectId?: string): ResolvedProject {
  return resolveProject(root, { projectId: explicitProjectId, walkUp: false });
}

export function resolveForMcp(cwd: string = process.cwd(), envProjectId?: string): ResolvedProject {
  const ctx = resolveMcpRootContext(cwd);
  assertMcpResolvable(ctx, envProjectId);
  return resolveProject(ctx.workspaceRoot, {
    envProjectId: envProjectId || undefined,
    walkUp: ctx.walkUp,
  });
}

export async function ensureProjectState(
  connectionString: string,
  manifest: KlmProjectManifest,
  tenant: ResolvedProject["tenant"]
): Promise<boolean> {
  const pool = new (await import("pg")).Pool({ connectionString });
  try {
    const existing = await pool.query(`SELECT 1 FROM project_states WHERE id = $1`, [
      manifest.projectId,
    ]);
    if (existing.rowCount && existing.rowCount > 0) return false;

    const state = ProjectStateSchema.parse({
      id: manifest.projectId,
      workspaceId: tenant.workspaceId,
      name: manifest.name,
      description: `KLM project linked to ${manifest.rootPath}`,
      goals: ["Persistent project memory across Cursor sessions"],
      businessModel: [],
      architecture: {
        summary: "IDE → KLM → PostgreSQL project memory + codebase index",
        components: [],
        dataFlows: [],
      },
      techStack: {
        languages: [],
        frameworks: [],
        databases: ["PostgreSQL"],
        infra: [],
        tools: ["KLM Runtime"],
      },
      invariants: [],
      decisions: [],
      risks: [],
      roadmap: [],
      codebaseMap: { rootPath: manifest.rootPath, fileCount: 0, modules: [] },
      updatedAt: new Date(),
    });

    await pool.query(
      `INSERT INTO project_states (id, workspace_id, state, updated_at)
       VALUES ($1, $2, $3::jsonb, NOW())`,
      [manifest.projectId, tenant.workspaceId, JSON.stringify(state)]
    );
    return true;
  } finally {
    await pool.end();
  }
}

function assertManifestFingerprint(
  manifest: KlmProjectManifest,
  current: ProjectFingerprint,
  allowOverride: boolean
): void {
  const stored = manifest.rootFingerprint;
  if (!stored || stored === current.rootFingerprint) return;
  if (allowOverride) return;
  throw new ProjectFingerprintMismatchError(
    manifest.rootPath,
    stored,
    current.rootFingerprint
  );
}

async function assertProjectIdBinding(
  store: ProjectsStore,
  projectId: string,
  fp: ProjectFingerprint,
  organizationId: string,
  force: boolean
): Promise<void> {
  const byId = await store.findById(projectId);
  if (byId && byId.rootFingerprint !== fp.rootFingerprint && !force) {
    throw new ProjectIdentityConflictError(
      projectId,
      byId.rootFingerprint,
      fp.rootFingerprint
    );
  }

  const byFp = await store.findByFingerprint(organizationId, fp.rootFingerprint);
  if (byFp && byFp.id !== projectId && !force) {
    throw new ProjectIdentityConflictError(
      byFp.id,
      byFp.rootFingerprint,
      fp.rootFingerprint
    );
  }
}

export interface InitProjectOptions {
  root: string;
  projectId?: string;
  connectionString?: string;
  tenant?: TenantDefaults;
  /** Update manifest + projects row to current fingerprint, keep projectId. */
  repair?: boolean;
  /** Allow rebinding projectId to a different fingerprint (explicit override). */
  force?: boolean;
}

export interface InitProjectResult {
  manifest: KlmProjectManifest;
  created: boolean;
  projectRowCreated: boolean;
  stateCreated: boolean;
  repaired: boolean;
}

/** Idempotent project bootstrap — strict identity, no silent rebinding. */
export async function initProject(options: InitProjectOptions): Promise<InitProjectResult> {
  const root = resolve(options.root);
  const tenant = options.tenant ?? tenantDefaults();
  const fp = computeFingerprint(root);
  const name = defaultProjectName(root);
  const allowOverride = Boolean(options.repair || options.force);
  const existing = readManifest(root);

  if (existing) {
    assertManifestFingerprint(existing, fp, allowOverride);

    if (options.projectId && options.projectId !== existing.projectId && !options.force) {
      throw new Error(
        `Manifest projectId is ${existing.projectId}; cannot switch to ${options.projectId} without --force`
      );
    }

    const projectId = options.projectId ?? existing.projectId;
    let repaired = false;

    if (options.connectionString) {
      const store = new ProjectsStore(options.connectionString);
      try {
        await assertProjectIdBinding(store, projectId, fp, tenant.organizationId, Boolean(options.force));
        await store.upsert({
          id: projectId,
          workspaceId: existing.workspaceId ?? tenant.workspaceId,
          organizationId: existing.organizationId ?? tenant.organizationId,
          name: existing.name,
          rootFingerprint: fp.rootFingerprint,
          gitRemote: fp.gitRemote,
          rootPathHash: fp.rootPathHash,
        });
      } finally {
        await store.close();
      }
    }

    const manifestChanged =
      existing.rootFingerprint !== fp.rootFingerprint ||
      existing.rootPath !== root ||
      (options.repair && existing.rootFingerprint !== fp.rootFingerprint);

    const manifest: KlmProjectManifest = {
      ...existing,
      projectId,
      name: existing.name || name,
      rootPath: root,
      rootFingerprint: fp.rootFingerprint,
      gitRemote: fp.gitRemote ?? undefined,
      rootPathHash: fp.rootPathHash,
    };

    if (manifestChanged || options.repair) {
      writeManifest(root, manifest);
      repaired = existing.rootFingerprint !== fp.rootFingerprint;
    }

    ensureGitignoreKlm(root);

    let stateCreated = false;
    if (options.connectionString) {
      stateCreated = await ensureProjectState(options.connectionString, manifest, {
        organizationId: manifest.organizationId ?? tenant.organizationId,
        workspaceId: manifest.workspaceId ?? tenant.workspaceId,
        userId: manifest.userId ?? tenant.userId,
      });
    }

    return {
      manifest,
      created: false,
      projectRowCreated: false,
      stateCreated,
      repaired,
    };
  }

  let projectId = options.projectId;
  let projectRowCreated = false;

  if (options.connectionString) {
    const store = new ProjectsStore(options.connectionString);
    try {
      if (projectId) {
        await assertProjectIdBinding(store, projectId, fp, tenant.organizationId, Boolean(options.force));
      } else {
        const byFp = await store.findByFingerprint(tenant.organizationId, fp.rootFingerprint);
        projectId = byFp?.id;
        projectRowCreated = !byFp;
      }

      if (!projectId) {
        projectId = randomUUID();
        projectRowCreated = true;
      }

      await store.upsert({
        id: projectId,
        workspaceId: tenant.workspaceId,
        organizationId: tenant.organizationId,
        name,
        rootFingerprint: fp.rootFingerprint,
        gitRemote: fp.gitRemote,
        rootPathHash: fp.rootPathHash,
      });
    } finally {
      await store.close();
    }
  } else if (!projectId) {
    projectId = randomUUID();
    projectRowCreated = true;
  }

  const manifest: KlmProjectManifest = {
    projectId: projectId!,
    name,
    rootPath: root,
    rootFingerprint: fp.rootFingerprint,
    gitRemote: fp.gitRemote ?? undefined,
    rootPathHash: fp.rootPathHash,
    createdAt: new Date().toISOString(),
    organizationId: tenant.organizationId,
    workspaceId: tenant.workspaceId,
    userId: tenant.userId,
  };

  writeManifest(root, manifest);
  ensureGitignoreKlm(root);

  let stateCreated = false;
  if (options.connectionString) {
    stateCreated = await ensureProjectState(options.connectionString, manifest, {
      organizationId: tenant.organizationId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
    });
  }

  return {
    manifest,
    created: true,
    projectRowCreated,
    stateCreated,
    repaired: false,
  };
}

export async function resolveProjectIdForRoot(
  root: string,
  explicitProjectId?: string
): Promise<string> {
  return resolveForCli(root, explicitProjectId).manifest.projectId;
}

export async function getProjectStats(
  connectionString: string,
  projectId: string
): Promise<import("./types.js").ProjectStats> {
  const store = new ProjectsStore(connectionString);
  try {
    return await store.getStats(projectId);
  } finally {
    await store.close();
  }
}
