import { randomUUID } from "node:crypto";
import type { TenantContext } from "@klm/core";

export type KlmEnvironment = "development" | "production" | "test";

export function getKlmEnvironment(): KlmEnvironment {
  const env = process.env.KLM_ENV ?? "development";
  if (env === "production" || env === "test") return env;
  return "development";
}

export class TenantValidationError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400
  ) {
    super(message);
    this.name = "TenantValidationError";
  }
}

function header(
  headers: Record<string, string | string[] | undefined>,
  key: string
): string | undefined {
  const value = headers[key];
  if (Array.isArray(value)) return value[0];
  return value;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireUuid(value: string | undefined, field: string): string {
  if (!value || !UUID_RE.test(value)) {
    throw new TenantValidationError(`Missing or invalid ${field}`);
  }
  return value;
}

/**
 * development: random UUID fallback when headers absent.
 * production: all X-KLM-* headers required.
 */
export function extractTenant(
  headers: Record<string, string | string[] | undefined>
): TenantContext {
  const env = getKlmEnvironment();
  const org = header(headers, "x-klm-organization-id");
  const workspace = header(headers, "x-klm-workspace-id");
  const project = header(headers, "x-klm-project-id");
  const user = header(headers, "x-klm-user-id");

  if (env === "production") {
    return {
      organizationId: requireUuid(org, "X-KLM-Organization-Id"),
      workspaceId: requireUuid(workspace, "X-KLM-Workspace-Id"),
      projectId: requireUuid(project, "X-KLM-Project-Id"),
      userId: requireUuid(user, "X-KLM-User-Id"),
      requestId: randomUUID(),
    };
  }

  return {
    organizationId: org && UUID_RE.test(org) ? org : randomUUID(),
    workspaceId: workspace && UUID_RE.test(workspace) ? workspace : randomUUID(),
    projectId: project && UUID_RE.test(project) ? project : randomUUID(),
    userId: user && UUID_RE.test(user) ? user : randomUUID(),
    requestId: randomUUID(),
  };
}
