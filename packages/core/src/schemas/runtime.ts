import { z } from "zod";
import {
  hashImpactTask,
  hashImplementationPlan,
  sanitizeImpactTaskPreview,
} from "../impact-task.js";

export const TaskTypeSchema = z.enum([
  "code",
  "architecture",
  "document",
  "debug",
  "review",
  "planning",
  "question",
  "refactor",
  "unknown",
]);

export const OutputFormatSchema = z.enum([
  "code",
  "architecture_doc",
  "markdown",
  "task_plan",
  "explanation",
  "mixed",
]);

export const QualityLevelSchema = z.enum(["fast", "balanced", "production"]);

export const ParsedIntentSchema = z.object({
  rawInput: z.string(),
  taskType: TaskTypeSchema,
  hiddenGoal: z.string().optional(),
  outputFormat: OutputFormatSchema,
  qualityLevel: QualityLevelSchema,
  entities: z.array(z.string()),
  urgency: z.enum(["low", "normal", "high"]).default("normal"),
  requiresVerification: z.boolean().default(true),
});

export type ParsedIntent = z.infer<typeof ParsedIntentSchema>;
export type TaskType = z.infer<typeof TaskTypeSchema>;
export type OutputFormat = z.infer<typeof OutputFormatSchema>;

export const SituationSchema = z.object({
  intent: ParsedIntentSchema,
  projectId: z.string().uuid(),
  userId: z.string().uuid(),
  recentContext: z.array(z.string()),
  activatedMemoryTypes: z.array(z.string()),
});

export type Situation = z.infer<typeof SituationSchema>;

export const CandidateActionSchema = z.object({
  id: z.string().uuid(),
  description: z.string(),
  approach: z.string(),
  estimatedComplexity: z.enum(["low", "medium", "high"]),
  affectedModules: z.array(z.string()),
});

export type CandidateAction = z.infer<typeof CandidateActionSchema>;

export const SimulatedFutureSchema = z.object({
  actionId: z.string().uuid(),
  scenarios: z.array(
    z.object({
      name: z.string(),
      outcome: z.string(),
      riskDelta: z.number(),
      score: z.number().min(0).max(1),
    })
  ),
  overallScore: z.number().min(0).max(1),
});

export type SimulatedFuture = z.infer<typeof SimulatedFutureSchema>;

export const RankedActionSchema = CandidateActionSchema.extend({
  rank: z.number().int().positive(),
  totalScore: z.number(),
  scores: z.record(z.number()),
});

export type RankedAction = z.infer<typeof RankedActionSchema>;

export const VerifiedActionSchema = RankedActionSchema.extend({
  passed: z.boolean(),
  violations: z.array(
    z.object({
      invariantId: z.string().optional(),
      rule: z.string(),
      severity: z.enum(["soft", "hard", "critical"]),
      message: z.string(),
      repaired: z.boolean(),
    })
  ),
  repairedOutput: z.string().optional(),
});

export type VerifiedAction = z.infer<typeof VerifiedActionSchema>;

export const CompiledOutputSchema = z.object({
  type: OutputFormatSchema,
  content: z.string(),
  artifacts: z.array(
    z.object({
      path: z.string(),
      content: z.string(),
      kind: z.enum(["code", "test", "config", "migration", "doc"]),
    })
  ),
  warnings: z.array(z.string()),
  implementationPlan: z.array(z.string()).optional(),
});

export type CompiledOutput = z.infer<typeof CompiledOutputSchema>;

export const CodebaseActivationReasonSchema = z.enum([
  "disabled",
  "no_terms",
  "no_hits",
  "error",
  "activated",
]);

export type CodebaseActivationReason = z.infer<typeof CodebaseActivationReasonSchema>;

export const CodebaseActivationCountsSchema = z.object({
  files: z.number().int().nonnegative(),
  routes: z.number().int().nonnegative(),
  symbols: z.number().int().nonnegative(),
  dependencies: z.number().int().nonnegative(),
});

export const CodebaseActivationReportSchema = z.object({
  activationUsed: z.boolean(),
  reason: CodebaseActivationReasonSchema,
  searchTerms: z.array(z.string()),
  counts: CodebaseActivationCountsSchema,
});

export type CodebaseActivationReport = z.infer<typeof CodebaseActivationReportSchema>;

export function emptyCodebaseActivationCounts(): CodebaseActivationReport["counts"] {
  return { files: 0, routes: 0, symbols: 0, dependencies: 0 };
}

/** When CodebaseMemoryActivator is not wired (env off or no DATABASE_URL). */
export function disabledCodebaseActivationReport(): CodebaseActivationReport {
  return {
    activationUsed: false,
    reason: "disabled",
    searchTerms: [],
    counts: emptyCodebaseActivationCounts(),
  };
}

export const MAX_PUBLIC_ACTIVATION_SEARCH_TERMS = 10;
export const MAX_PUBLIC_ACTIVATION_TERM_LENGTH = 80;

/** API/audit-safe view — bounded terms, no extra fields. */
export function publicCodebaseActivationReport(
  report: CodebaseActivationReport
): CodebaseActivationReport {
  const searchTerms = report.searchTerms
    .map((t) => t.trim().slice(0, MAX_PUBLIC_ACTIVATION_TERM_LENGTH))
    .filter((t) => t.length > 0)
    .slice(0, MAX_PUBLIC_ACTIVATION_SEARCH_TERMS);

  return {
    activationUsed: report.activationUsed,
    reason: report.reason,
    searchTerms,
    counts: {
      files: report.counts.files,
      routes: report.counts.routes,
      symbols: report.counts.symbols,
      dependencies: report.counts.dependencies,
    },
  };
}

export const ImpactConfidenceSchema = z.enum(["low", "medium", "high"]);
export type ImpactConfidence = z.infer<typeof ImpactConfidenceSchema>;

export const ImpactAffectedFileSchema = z.object({
  path: z.string(),
  language: z.string().optional(),
  score: z.number().min(0).max(1),
});

export const ImpactAffectedRouteSchema = z.object({
  httpMethod: z.string(),
  path: z.string(),
  filePath: z.string(),
  score: z.number().min(0).max(1),
});

export const ImpactAffectedSymbolSchema = z.object({
  name: z.string(),
  filePath: z.string(),
  symbolType: z.string().optional(),
  score: z.number().min(0).max(1),
});

export const ImpactRelatedInvariantSchema = z.object({
  id: z.string().uuid(),
  rule: z.string(),
  severity: z.enum(["soft", "hard", "critical"]),
  score: z.number().min(0).max(1),
});

export const ImpactRelatedDecisionSchema = z.object({
  id: z.string().uuid(),
  decision: z.string(),
  score: z.number().min(0).max(1),
});

export const ImpactRiskItemSchema = z.object({
  message: z.string(),
  severity: z.enum(["low", "medium", "high", "critical"]),
  source: z.enum(["invariant", "decision", "coverage"]),
});

export const ImpactSuggestedTestSchema = z.object({
  kind: z.enum(["e2e", "integration", "unit", "manual"]),
  description: z.string(),
});

export const ImpactAnalysisReportSchema = z.object({
  taskPreview: z.string(),
  taskHash: z.string(),
  searchTerms: z.array(z.string()),
  affectedFiles: z.array(ImpactAffectedFileSchema),
  affectedRoutes: z.array(ImpactAffectedRouteSchema),
  affectedSymbols: z.array(ImpactAffectedSymbolSchema),
  relatedInvariants: z.array(ImpactRelatedInvariantSchema),
  relatedDecisions: z.array(ImpactRelatedDecisionSchema),
  risks: z.array(ImpactRiskItemSchema),
  suggestedTests: z.array(ImpactSuggestedTestSchema),
  confidence: ImpactConfidenceSchema,
  metadataOnly: z.literal(true),
});

export type ImpactAnalysisReport = z.infer<typeof ImpactAnalysisReportSchema>;

export const MAX_IMPACT_ITEMS = 100;
export const MAX_IMPACT_TEXT_LENGTH = 240;

export type ImpactAnalysisBody = Omit<ImpactAnalysisReport, "taskPreview" | "taskHash">;

export function emptyImpactReport(rawTask = ""): ImpactAnalysisReport {
  return publicImpactAnalysisReport(rawTask, {
    searchTerms: [],
    affectedFiles: [],
    affectedRoutes: [],
    affectedSymbols: [],
    relatedInvariants: [],
    relatedDecisions: [],
    risks: [],
    suggestedTests: [],
    confidence: "low",
    metadataOnly: true,
  });
}

/** API/MCP-safe view — bounded arrays and text, metadata paths only; no raw task echo. */
export function publicImpactAnalysisReport(
  rawTask: string,
  report: ImpactAnalysisBody,
  limit = MAX_IMPACT_ITEMS
): ImpactAnalysisReport {
  const cap = Math.min(Math.max(1, limit), MAX_IMPACT_ITEMS);
  const trim = (s: string) => s.trim().slice(0, MAX_IMPACT_TEXT_LENGTH);

  return {
    taskPreview: sanitizeImpactTaskPreview(rawTask),
    taskHash: hashImpactTask(rawTask),
    searchTerms: report.searchTerms.slice(0, 20),
    affectedFiles: report.affectedFiles.slice(0, cap),
    affectedRoutes: report.affectedRoutes.slice(0, cap),
    affectedSymbols: report.affectedSymbols.slice(0, cap),
    relatedInvariants: report.relatedInvariants.slice(0, cap).map((i) => ({
      ...i,
      rule: trim(i.rule),
    })),
    relatedDecisions: report.relatedDecisions.slice(0, cap).map((d) => ({
      ...d,
      decision: trim(d.decision),
    })),
    risks: report.risks.slice(0, cap).map((r) => ({ ...r, message: trim(r.message) })),
    suggestedTests: report.suggestedTests.slice(0, cap).map((t) => ({
      ...t,
      description: trim(t.description),
    })),
    confidence: report.confidence,
    metadataOnly: true,
  };
}

export const PlanVerdictSchema = z.enum(["safe", "needs_changes", "blocked"]);
export type PlanVerdict = z.infer<typeof PlanVerdictSchema>;

export const ImplementationPlanRouteSchema = z.object({
  httpMethod: z.string().max(16),
  path: z.string().max(240),
});

export const ImplementationPlanSchema = z.object({
  steps: z.array(z.string().max(500)).min(1).max(50),
  files: z.array(z.string().max(240)).max(100).optional(),
  routes: z.array(ImplementationPlanRouteSchema).max(50).optional(),
  tests: z.array(z.string().max(500)).max(50).optional(),
});

export type ImplementationPlan = z.infer<typeof ImplementationPlanSchema>;

export const PlanViolationSchema = z.object({
  rule: z.string(),
  message: z.string(),
  severity: z.enum(["soft", "hard", "critical"]),
  source: z.enum(["invariant", "decision", "scope", "coverage"]),
});

export const PlanVerificationReportSchema = z.object({
  taskPreview: z.string(),
  taskHash: z.string(),
  planPreview: z.string(),
  planHash: z.string(),
  verdict: PlanVerdictSchema,
  violations: z.array(PlanViolationSchema),
  missingTests: z.array(z.string()),
  riskNotes: z.array(z.string()),
  requiredChanges: z.array(z.string()),
  confidence: ImpactConfidenceSchema,
  impactConfidence: ImpactConfidenceSchema,
  metadataOnly: z.literal(true),
});

export type PlanVerificationReport = z.infer<typeof PlanVerificationReportSchema>;

export type PlanVerificationBody = Omit<
  PlanVerificationReport,
  "taskPreview" | "taskHash" | "planPreview" | "planHash"
>;

export const MAX_PLAN_TEXT_LENGTH = 240;

export function normalizePlanForHash(plan: ImplementationPlan): string {
  return JSON.stringify({
    steps: plan.steps.map((s) => s.trim()),
    files: (plan.files ?? []).map((f) => f.trim()).sort(),
    routes: (plan.routes ?? [])
      .map((r) => ({ httpMethod: r.httpMethod.trim().toUpperCase(), path: r.path.trim() }))
      .sort((a, b) => `${a.httpMethod}${a.path}`.localeCompare(`${b.httpMethod}${b.path}`)),
    tests: (plan.tests ?? []).map((t) => t.trim()).sort(),
  });
}

export function publicPlanVerificationReport(
  rawTask: string,
  plan: ImplementationPlan,
  report: PlanVerificationBody
): PlanVerificationReport {
  const planSummary = plan.steps.join("; ");
  const trim = (s: string) => s.trim().slice(0, MAX_PLAN_TEXT_LENGTH);

  return {
    taskPreview: sanitizeImpactTaskPreview(rawTask),
    taskHash: hashImpactTask(rawTask),
    planPreview: sanitizeImpactTaskPreview(planSummary),
    planHash: hashImplementationPlan(normalizePlanForHash(plan)),
    verdict: report.verdict,
    violations: report.violations.slice(0, MAX_IMPACT_ITEMS).map((v) => ({
      ...v,
      rule: trim(v.rule),
      message: trim(v.message),
    })),
    missingTests: report.missingTests.slice(0, MAX_IMPACT_ITEMS).map(trim),
    riskNotes: report.riskNotes.slice(0, MAX_IMPACT_ITEMS).map(trim),
    requiredChanges: report.requiredChanges.slice(0, MAX_IMPACT_ITEMS).map(trim),
    confidence: report.confidence,
    impactConfidence: report.impactConfidence,
    metadataOnly: true,
  };
}
