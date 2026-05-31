import type { FastifyInstance } from "fastify";
import { CodebaseQueryReader } from "@klm/codebase-indexer";
import { extractTenant } from "@klm/bootstrap";
import { ImpactAnalyzer } from "@klm/impact-analyzer";
import type { StateStore } from "@klm/state-store";
import { assertProjectAccess } from "../lib/tenant-access.js";

/**
 * Read-only impact analysis (Phase 2.7). Metadata-only — no file content, no writes.
 */
export function registerImpactRoutes(
  app: FastifyInstance,
  connectionString: string,
  store: StateStore
): void {
  const reader = new CodebaseQueryReader(connectionString);
  const analyzer = new ImpactAnalyzer(reader, {
    getInvariants: (pid) => store.getInvariants(pid),
    getDecisions: (pid) => store.getDecisions(pid),
    getRisks: async (pid) => {
      const state = await store.getProjectState(pid);
      return state?.risks ?? [];
    },
  });

  app.addHook("onClose", async () => {
    await reader.close();
  });

  app.post<{
    Params: { projectId: string };
    Body: { task?: string; limit?: number };
  }>("/v1/projects/:projectId/impact/analyze", async (request, reply) => {
    const { projectId } = request.params;
    const tenant = extractTenant(request.headers);
    if (!assertProjectAccess(tenant.projectId, projectId, reply)) return;

    const task = request.body?.task ?? "";
    if (typeof task !== "string") {
      return reply.code(400).send({ error: "task must be a string" });
    }

    const report = await analyzer.analyze({
      task,
      projectId,
      limit: request.body?.limit,
    });

    return { projectId, ...report };
  });
}
