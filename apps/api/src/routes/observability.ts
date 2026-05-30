import type { FastifyInstance } from "fastify";
import { ObservabilityReader, parseLimit } from "@klm/audit";
import { extractTenant } from "@klm/bootstrap";
import { assertProjectAccess, resolveScopedProjectId } from "../lib/tenant-access.js";

export function registerObservabilityRoutes(
  app: FastifyInstance,
  connectionString: string
): void {
  const reader = new ObservabilityReader(connectionString);

  app.addHook("onClose", async () => {
    await reader.close();
  });

  app.get<{
    Params: { projectId: string };
    Querystring: { limit?: string; cursor?: string };
  }>("/v1/projects/:projectId/events", async (request, reply) => {
    const { projectId } = request.params;
    const tenant = extractTenant(request.headers);
    if (!assertProjectAccess(tenant.projectId, projectId, reply)) return;

    const limit = parseLimit(request.query.limit);
    const result = await reader.listEvents({
      projectId,
      limit,
      cursor: request.query.cursor,
    });

    return { projectId, ...result };
  });

  app.get<{
    Params: { projectId: string };
    Querystring: { limit?: string; cursor?: string; type?: string };
  }>("/v1/projects/:projectId/memory-chunks", async (request, reply) => {
    const { projectId } = request.params;
    const tenant = extractTenant(request.headers);
    if (!assertProjectAccess(tenant.projectId, projectId, reply)) return;

    const limit = parseLimit(request.query.limit);
    const result = await reader.listMemoryChunks({
      projectId,
      limit,
      cursor: request.query.cursor,
      chunkType: request.query.type,
    });

    return { projectId, ...result };
  });

  app.get<{
    Querystring: { projectId?: string; limit?: string; cursor?: string };
  }>("/v1/admin/model-calls", async (request, reply) => {
    const tenant = extractTenant(request.headers);
    const projectId = resolveScopedProjectId(tenant, request.query.projectId, reply);
    if (!projectId) return;

    const limit = parseLimit(request.query.limit);
    const result = await reader.listModelCalls({
      projectId,
      limit,
      cursor: request.query.cursor,
    });

    return { projectId, ...result };
  });

  app.get<{
    Querystring: { projectId?: string; limit?: string; cursor?: string };
  }>("/v1/admin/audit-logs", async (request, reply) => {
    const tenant = extractTenant(request.headers);
    const projectId = resolveScopedProjectId(tenant, request.query.projectId, reply);
    if (!projectId) return;

    const limit = parseLimit(request.query.limit);
    const result = await reader.listAuditLogs({
      projectId,
      limit,
      cursor: request.query.cursor,
    });

    return { projectId, ...result };
  });
}
