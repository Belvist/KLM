import type { CodeImplementation, CodeVerificationReport, PlanVerificationReport } from "@klm/core";
import type { CodeVerifier } from "./code-verifier.js";

export interface CodeVerifyToolInput {
  task: string;
  implementation: CodeImplementation;
  limit?: number;
  planReport?: PlanVerificationReport;
  /** Must match tenant projectId if provided — never trusted alone. */
  projectId?: string;
}

export type CodeVerifyToolResult =
  | CodeVerificationReport
  | {
      error: string;
      code: "FORBIDDEN" | "NO_DATABASE" | "INVALID_TASK" | "INVALID_IMPLEMENTATION";
    };

export async function handleCodeVerify(
  verifier: CodeVerifier | null,
  tenantProjectId: string,
  input: CodeVerifyToolInput
): Promise<CodeVerifyToolResult> {
  if (!verifier) {
    return {
      error: "Code verification requires DATABASE_URL and postgres backend",
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

  if (input.implementation.summary.length > 8000) {
    return {
      error: "Implementation summary too long (max 8000 chars)",
      code: "INVALID_IMPLEMENTATION",
    };
  }

  try {
    return await verifier.verify({
      task: input.task,
      implementation: input.implementation,
      projectId: tenantProjectId,
      limit: input.limit,
      planReport: input.planReport,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Required") || msg.includes("too short")) {
      return { error: `Invalid implementation: ${msg}`, code: "INVALID_IMPLEMENTATION" };
    }
    throw err;
  }
}
