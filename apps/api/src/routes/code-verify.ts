import type { FastifyInstance } from "fastify";
import { CodebaseQueryReader } from "@klm/codebase-indexer";
import { extractTenant } from "@klm/bootstrap";
import { ImpactAnalyzer } from "@klm/impact-analyzer";
import { CodeVerifier } from "@klm/code-verifier";
import type { CodeImplementation, PlanVerificationReport } from "@klm/core";
import type { StateStore } from "@klm/state-store";
import { assertProjectAccess } from "../lib/tenant-access.js";

/**
 * Read-only code verification (Phase 2.9). Uses impact + rule checks — no writes.
 */
export function registerCodeVerifyRoutes(
  app: FastifyInstance,
  connectionString: string,
  store: StateStore
): void {
  const reader = new CodebaseQueryReader(connectionString);
  const impactAnalyzer = new ImpactAnalyzer(reader, {
    getInvariants: (pid) => store.getInvariants(pid),
    getDecisions: (pid) => store.getDecisions(pid),
    getRisks: async (pid) => {
      const state = await store.getProjectState(pid);
      return state?.risks ?? [];
    },
  });
  const codeVerifier = new CodeVerifier(impactAnalyzer);

  app.addHook("onClose", async () => {
    await reader.close();
  });

  app.post<{
    Params: { projectId: string };
    Body: {
      task?: string;
      implementation?: CodeImplementation;
      planReport?: PlanVerificationReport;
      limit?: number;
    };
  }>("/v1/projects/:projectId/code/verify", async (request, reply) => {
    const { projectId } = request.params;
    const tenant = extractTenant(request.headers);
    if (!assertProjectAccess(tenant.projectId, projectId, reply)) return;

    const task = request.body?.task ?? "";
    if (typeof task !== "string") {
      return reply.code(400).send({ error: "task must be a string" });
    }

    const implementation = request.body?.implementation;
    if (!implementation?.summary?.trim()) {
      return reply.code(400).send({ error: "implementation.summary is required" });
    }

    try {
      const report = await codeVerifier.verify({
        task,
        implementation,
        projectId,
        limit: request.body?.limit,
        planReport: request.body?.planReport,
      });
      return { projectId, ...report };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(400).send({ error: msg });
    }
  });
}
