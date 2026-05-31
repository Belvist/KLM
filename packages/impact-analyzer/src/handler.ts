import type { ImpactAnalysisReport } from "@klm/core";
import type { ImpactAnalyzer } from "./impact-analyzer.js";

export interface ImpactAnalyzeToolInput {
  task: string;
  limit?: number;
  /** Must match tenant projectId if provided — never trusted alone. */
  projectId?: string;
}

export type ImpactAnalyzeToolResult =
  | ImpactAnalysisReport
  | { error: string; code: "FORBIDDEN" | "NO_DATABASE" | "INVALID_TASK" };

export async function handleImpactAnalyze(
  analyzer: ImpactAnalyzer | null,
  tenantProjectId: string,
  input: ImpactAnalyzeToolInput
): Promise<ImpactAnalyzeToolResult> {
  if (!analyzer) {
    return {
      error: "Impact analysis requires DATABASE_URL and postgres backend",
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

  return analyzer.analyze({
    task: input.task,
    projectId: tenantProjectId,
    limit: input.limit,
  });
}
