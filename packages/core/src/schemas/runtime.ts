import { z } from "zod";

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
