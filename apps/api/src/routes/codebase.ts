import type { FastifyInstance } from "fastify";
import { CodebaseQueryReader, parseQueryLimit } from "@klm/codebase-indexer";
import { extractTenant } from "@klm/bootstrap";
import { assertProjectAccess } from "../lib/tenant-access.js";

/**
 * Read-only codebase index queries (Phase 2.5). Project-scoped; no file content returned.
 */
export function registerCodebaseRoutes(app: FastifyInstance, connectionString: string): void {
  const reader = new CodebaseQueryReader(connectionString);

  app.addHook("onClose", async () => {
    await reader.close();
  });

  app.get<{
    Params: { projectId: string };
    Querystring: { limit?: string; cursor?: string; pathPrefix?: string; q?: string };
  }>("/v1/projects/:projectId/codebase/files", async (request, reply) => {
    const { projectId } = request.params;
    const tenant = extractTenant(request.headers);
    if (!assertProjectAccess(tenant.projectId, projectId, reply)) return;

    const limit = parseQueryLimit(request.query.limit);
    const result = await reader.listFiles({
      projectId,
      limit,
      cursor: request.query.cursor,
      pathPrefix: request.query.pathPrefix,
      q: request.query.q,
    });

    return { projectId, limit, ...result };
  });

  app.get<{
    Params: { projectId: string };
    Querystring: { limit?: string; cursor?: string; path?: string; method?: string };
  }>("/v1/projects/:projectId/codebase/routes", async (request, reply) => {
    const { projectId } = request.params;
    const tenant = extractTenant(request.headers);
    if (!assertProjectAccess(tenant.projectId, projectId, reply)) return;

    const limit = parseQueryLimit(request.query.limit);
    const result = await reader.listRoutes({
      projectId,
      limit,
      cursor: request.query.cursor,
      path: request.query.path,
      httpMethod: request.query.method,
    });

    return { projectId, limit, ...result };
  });

  app.get<{
    Params: { projectId: string };
    Querystring: {
      limit?: string;
      cursor?: string;
      name?: string;
      type?: string;
      exported?: string;
    };
  }>("/v1/projects/:projectId/codebase/symbols", async (request, reply) => {
    const { projectId } = request.params;
    const tenant = extractTenant(request.headers);
    if (!assertProjectAccess(tenant.projectId, projectId, reply)) return;

    const limit = parseQueryLimit(request.query.limit);
    const exported =
      request.query.exported === "true"
        ? true
        : request.query.exported === "false"
          ? false
          : undefined;

    const result = await reader.listSymbols({
      projectId,
      limit,
      cursor: request.query.cursor,
      name: request.query.name,
      symbolType: request.query.type,
      exported,
    });

    return { projectId, limit, ...result };
  });

  app.get<{
    Params: { projectId: string };
    Querystring: { limit?: string; cursor?: string; targetModule?: string; filePath?: string };
  }>("/v1/projects/:projectId/codebase/dependencies", async (request, reply) => {
    const { projectId } = request.params;
    const tenant = extractTenant(request.headers);
    if (!assertProjectAccess(tenant.projectId, projectId, reply)) return;

    const limit = parseQueryLimit(request.query.limit);
    const result = await reader.listDependencies({
      projectId,
      limit,
      cursor: request.query.cursor,
      targetModule: request.query.targetModule,
      filePath: request.query.filePath,
    });

    return { projectId, limit, ...result };
  });
}
