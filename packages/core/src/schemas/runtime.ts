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
