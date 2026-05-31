import type { FastifyInstance } from "fastify";
import { CodebaseQueryReader } from "@klm/codebase-indexer";
import { extractTenant } from "@klm/bootstrap";
import { ImpactAnalyzer } from "@klm/impact-analyzer";
import { PlanVerifier } from "@klm/plan-verifier";
import type { ImplementationPlan } from "@klm/core";
import type { StateStore } from "@klm/state-store";
import { assertProjectAccess } from "../lib/tenant-access.js";

/**
 * Read-only plan verification (Phase 2.8). Uses impact report + rule checks — no writes.
 */
export function registerPlanVerifyRoutes(
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
  const planVerifier = new PlanVerifier(impactAnalyzer);

  app.addHook("onClose", async () => {
    await reader.close();
  });

  app.post<{
    Params: { projectId: string };
    Body: { task?: string; plan?: ImplementationPlan; limit?: number };
  }>("/v1/projects/:projectId/plans/verify", async (request, reply) => {
    const { projectId } = request.params;
    const tenant = extractTenant(request.headers);
    if (!assertProjectAccess(tenant.projectId, projectId, reply)) return;

    const task = request.body?.task ?? "";
    if (typeof task !== "string") {
      return reply.code(400).send({ error: "task must be a string" });
    }

    const plan = request.body?.plan;
    if (!plan || !Array.isArray(plan.steps) || plan.steps.length === 0) {
      return reply.code(400).send({ error: "plan.steps must be a non-empty array" });
    }

    try {
      const report = await planVerifier.verify({
        task,
        plan,
        projectId,
        limit: request.body?.limit,
      });
      return { projectId, ...report };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(400).send({ error: msg });
    }
  });
}
