import type {
  ImplementationPlan,
  ImpactConfidence,
  PlanVerificationBody,
  PlanVerificationReport,
} from "@klm/core";
import { ImplementationPlanSchema, publicPlanVerificationReport } from "@klm/core";
import type { ImpactAnalyzer } from "@klm/impact-analyzer";
import {
  buildPlanSearchText,
  collectRiskNotes,
  computePlanConfidence,
  computePlanVerdict,
  detectInvariantViolations,
  detectMissingTests,
  detectOutOfScopeFiles,
} from "./rules.js";

export interface PlanVerifyOptions {
  task: string;
  plan: ImplementationPlan;
  projectId: string;
  limit?: number;
}

export class PlanVerifier {
  constructor(private impactAnalyzer: ImpactAnalyzer) {}

  async verify(options: PlanVerifyOptions): Promise<PlanVerificationReport> {
    const task = options.task.trim();
    const parsed = ImplementationPlanSchema.parse(options.plan);

    const impact = await this.impactAnalyzer.analyze({
      task,
      projectId: options.projectId,
      limit: options.limit,
    });

    const planText = buildPlanSearchText(parsed);
    const violations = detectInvariantViolations(planText, impact);
    const outOfScope = detectOutOfScopeFiles(parsed, impact);
    const missingTests = detectMissingTests(parsed, impact);
    const riskNotes = collectRiskNotes(impact);

    const requiredChanges: string[] = [];
    for (const f of outOfScope) {
      requiredChanges.push(`File not in impact scope: ${f}`);
    }
    if (impact.confidence === "low" && impact.affectedFiles.length === 0) {
      requiredChanges.push("Insufficient impact context — refine task or re-index codebase");
    }

    const verdict = computePlanVerdict(
      violations,
      missingTests,
      requiredChanges,
      impact.confidence
    );
    const confidence = computePlanConfidence(verdict, impact.confidence);

    const body: PlanVerificationBody = {
      verdict,
      violations,
      missingTests,
      riskNotes,
      requiredChanges,
      confidence,
      impactConfidence: impact.confidence,
      metadataOnly: true,
    };

    return publicPlanVerificationReport(task, parsed, body);
  }
}

export function parseImplementationPlan(raw: unknown): ImplementationPlan {
  return ImplementationPlanSchema.parse(raw);
}

export { ImpactConfidence };
