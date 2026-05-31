import type { ImplementationPlan, PlanVerificationReport } from "@klm/core";
import type { PlanVerifier } from "./plan-verifier.js";

export interface PlanVerifyToolInput {
  task: string;
  plan: ImplementationPlan;
  limit?: number;
  /** Must match tenant projectId if provided — never trusted alone. */
  projectId?: string;
}

export type PlanVerifyToolResult =
  | PlanVerificationReport
  | {
      error: string;
      code: "FORBIDDEN" | "NO_DATABASE" | "INVALID_TASK" | "INVALID_PLAN";
    };

export async function handlePlanVerify(
  verifier: PlanVerifier | null,
  tenantProjectId: string,
  input: PlanVerifyToolInput
): Promise<PlanVerifyToolResult> {
  if (!verifier) {
    return {
      error: "Plan verification requires DATABASE_URL and postgres backend",
      code: "NO_DATABASE",
    };
  }

  if (input.projectId && input.projectId !== tenantProjectId) {
    return {
      error: "Forbidden: project does not match configured tenant context",
      code: "FORBIDDEN",
    };
  }

  if (input.task.length > 4000) {
    return { error: "Task description too long (max 4000 chars)", code: "INVALID_TASK" };
  }

  const stepsLen = input.plan.steps.join("").length;
  if (stepsLen > 8000) {
    return { error: "Plan steps too long (max 8000 chars total)", code: "INVALID_PLAN" };
  }

  try {
    return await verifier.verify({
      task: input.task,
      plan: input.plan,
      projectId: tenantProjectId,
      limit: input.limit,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Required") || msg.includes("Array")) {
      return { error: `Invalid plan: ${msg}`, code: "INVALID_PLAN" };
    }
    throw err;
  }
}
