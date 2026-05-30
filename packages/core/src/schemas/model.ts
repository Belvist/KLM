import { z } from "zod";

export const ModelProviderIdSchema = z.enum([
  "openai",
  "anthropic",
  "gemini",
  "openrouter",
  "local",
  "klm_native",
]);

export type ModelProviderId = z.infer<typeof ModelProviderIdSchema>;

export const ModelCapabilitySchema = z.object({
  tools: z.boolean(),
  vision: z.boolean(),
  longContext: z.boolean(),
  structuredOutput: z.boolean(),
  streaming: z.boolean(),
});

export type ModelCapability = z.infer<typeof ModelCapabilitySchema>;

export const ModelMessageRoleSchema = z.enum(["system", "user", "assistant", "tool"]);

export const ModelMessageSchema = z.object({
  role: ModelMessageRoleSchema,
  content: z.string(),
  name: z.string().optional(),
});

export type ModelMessage = z.infer<typeof ModelMessageSchema>;

export const ReasoningTaskTypeSchema = z.enum([
  "intent",
  "memory_compression",
  "planning",
  "codegen",
  "verification",
  "summarization",
  "embedding",
  "general",
]);

export type ReasoningTaskType = z.infer<typeof ReasoningTaskTypeSchema>;

export const ModelRequestSchema = z.object({
  taskType: ReasoningTaskTypeSchema,
  messages: z.array(ModelMessageSchema),
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
  stream: z.boolean().default(false),
  jsonMode: z.boolean().default(false),
  requestId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
});

export type ModelRequest = z.infer<typeof ModelRequestSchema>;

export const ModelResponseSchema = z.object({
  content: z.string(),
  model: z.string(),
  provider: ModelProviderIdSchema,
  finishReason: z.enum(["stop", "length", "tool_calls", "error"]).optional(),
  usage: z
    .object({
      promptTokens: z.number().int(),
      completionTokens: z.number().int(),
      totalTokens: z.number().int(),
    })
    .optional(),
});

export type ModelResponse = z.infer<typeof ModelResponseSchema>;

export const ModelChunkSchema = z.object({
  content: z.string(),
  done: z.boolean(),
});

export type ModelChunk = z.infer<typeof ModelChunkSchema>;

export const CostEstimateSchema = z.object({
  promptCostUsd: z.number(),
  completionCostUsd: z.number(),
  totalCostUsd: z.number(),
});

export type CostEstimate = z.infer<typeof CostEstimateSchema>;

export const RoutingPolicySchema = z.record(ReasoningTaskTypeSchema, z.string());

export type RoutingPolicy = z.infer<typeof RoutingPolicySchema>;

export const DEFAULT_ROUTING_POLICY: RoutingPolicy = {
  intent: "cheap-fast",
  memory_compression: "cheap-structured",
  planning: "strong-reasoning",
  codegen: "code-strong",
  verification: "verifier-balanced",
  summarization: "cheap-fast",
  embedding: "embedding",
  general: "balanced",
};

export const MODEL_CLASS_MAP: Record<string, { provider: ModelProviderId; model: string }> = {
  "cheap-fast": { provider: "openrouter", model: "openai/gpt-4o-mini" },
  "cheap-structured": { provider: "openrouter", model: "openai/gpt-4o-mini" },
  "strong-reasoning": { provider: "openrouter", model: "anthropic/claude-sonnet-4" },
  "code-strong": { provider: "openrouter", model: "anthropic/claude-sonnet-4" },
  "verifier-balanced": { provider: "openrouter", model: "openai/gpt-4o-mini" },
  embedding: { provider: "openai", model: "text-embedding-3-small" },
  balanced: { provider: "openrouter", model: "anthropic/claude-sonnet-4" },
  local: { provider: "local", model: "llama3.2" },
};
