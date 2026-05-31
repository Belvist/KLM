export class ProjectNotInitializedError extends Error {
  readonly code = "PROJECT_NOT_INITIALIZED" as const;

  constructor(root: string, hint?: string) {
    super(hint ?? `KLM project not initialized at ${root}. Run: pnpm klm:init -- --root "${root}"`);
    this.name = "ProjectNotInitializedError";
  }
}

export class ProjectFingerprintMismatchError extends Error {
  readonly code = "PROJECT_FINGERPRINT_MISMATCH" as const;

  constructor(root: string, manifestFingerprint: string, currentFingerprint: string) {
    super(
      `KLM project fingerprint mismatch at ${root}. ` +
        `manifest=${manifestFingerprint} current=${currentFingerprint}. ` +
        `Run: pnpm klm:init -- --root "${root}" --repair` +
        ` (keep projectId) or --project-id <uuid> --force`
    );
    this.name = "ProjectFingerprintMismatchError";
  }
}

export class ProjectIdentityConflictError extends Error {
  readonly code = "PROJECT_IDENTITY_CONFLICT" as const;

  constructor(projectId: string, existingFingerprint: string, requestedFingerprint: string) {
    super(
      `Project ${projectId} is registered with fingerprint ${existingFingerprint}, ` +
        `cannot bind to ${requestedFingerprint}. Use --force only if intentional.`
    );
    this.name = "ProjectIdentityConflictError";
  }
}

export class McpWorkspaceRootError extends Error {
  readonly code = "MCP_WORKSPACE_ROOT_REQUIRED" as const;

  constructor(cwd: string) {
    super(
      `KLM MCP could not resolve project from cwd=${cwd}. ` +
        `Set KLM_WORKSPACE_ROOT in .cursor/mcp.json to the target repo root ` +
        `(run pnpm klm:init on that repo).`
    );
    this.name = "McpWorkspaceRootError";
  }
}
