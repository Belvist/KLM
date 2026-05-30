import type { TenantContext } from "@klm/core";

export function assertProjectAccess(
  tenantProjectId: string,
  urlProjectId: string,
  reply: import("fastify").FastifyReply
): boolean {
  if (tenantProjectId !== urlProjectId) {
    reply.code(403).send({ error: "Forbidden: project does not match tenant context" });
    return false;
  }
  return true;
}

/** Admin query projectId must match tenant or default to tenant project. */
export function resolveScopedProjectId(
  tenant: TenantContext,
  queryProjectId: string | undefined,
  reply: import("fastify").FastifyReply
): string | null {
  const scoped = queryProjectId ?? tenant.projectId;
  if (scoped !== tenant.projectId) {
    reply.code(403).send({ error: "Forbidden: project does not match tenant context" });
    return null;
  }
  return scoped;
}
