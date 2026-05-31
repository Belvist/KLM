import { resolve } from "node:path";
import { findProjectRoot, readManifest } from "./project-config.js";
import { McpWorkspaceRootError, ProjectNotInitializedError } from "./errors.js";

/**
 * MCP workspace root resolution (strict):
 * 1. KLM_WORKSPACE_ROOT env (set by klm:init in target repo mcp.json)
 * 2. process.cwd()
 *
 * When KLM_WORKSPACE_ROOT is unset, manifest must exist at cwd exactly —
 * no walk-up (avoids binding to parent monorepo when MCP starts from klm-runtime).
 */
export function resolveMcpWorkspaceRoot(cwd: string = process.cwd()): string {
  if (process.env.KLM_WORKSPACE_ROOT) {
    return resolve(process.env.KLM_WORKSPACE_ROOT);
  }
  return resolve(cwd);
}

export interface McpRootContext {
  workspaceRoot: string;
  walkUp: boolean;
}

export function resolveMcpRootContext(cwd: string = process.cwd()): McpRootContext {
  const explicit = process.env.KLM_WORKSPACE_ROOT;
  if (explicit) {
    return { workspaceRoot: resolve(explicit), walkUp: true };
  }
  return { workspaceRoot: resolve(cwd), walkUp: false };
}

/** Pre-flight: fail fast when MCP would bind to wrong project. */
export function assertMcpResolvable(ctx: McpRootContext, envProjectId?: string): void {
  if (envProjectId) return;

  const manifest = readManifest(ctx.workspaceRoot);
  if (manifest) return;

  if (ctx.walkUp && findProjectRoot(ctx.workspaceRoot)) return;

  if (!process.env.KLM_WORKSPACE_ROOT) {
    throw new McpWorkspaceRootError(ctx.workspaceRoot);
  }

  throw new ProjectNotInitializedError(
    ctx.workspaceRoot,
    `KLM project not initialized at ${ctx.workspaceRoot}. Run: pnpm klm:init -- --root "<repo>"`
  );
}
