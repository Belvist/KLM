import type {
  ModelProviderId,
  ModelRequest,
  ModelResponse,
  ReasoningTaskType,
  RoutingPolicy,
  SecurityPolicy,
} from "@klm/core";

import { MODEL_CLASS_MAP } from "@klm/core";

import type { AuditLogger } from "@klm/audit";

import type { ModelAdapter } from "./types.js";

import { AnthropicAdapter } from "./anthropic-adapter.js";

import { OpenAIAdapter } from "./openai-adapter.js";

import { OpenRouterAdapter } from "./openrouter-adapter.js";

export interface ModelRouterConfig {
  routingPolicy?: RoutingPolicy;

  securityPolicy?: SecurityPolicy;

  adapters?: Partial<Record<ModelProviderId, ModelAdapter>>;

  audit?: AuditLogger;
}

export class ModelRouter {
  private adapters: Map<ModelProviderId, ModelAdapter>;

  private routingPolicy: RoutingPolicy;

  private defaultProvider?: ModelProviderId;

  private defaultModel?: string;

  private audit?: AuditLogger;

  constructor(config: ModelRouterConfig = {}) {
    this.audit = config.audit;

    this.defaultProvider = process.env.KLM_DEFAULT_PROVIDER as ModelProviderId | undefined;

    this.defaultModel = process.env.KLM_DEFAULT_MODEL;

    this.routingPolicy = config.routingPolicy ?? {
      intent: "cheap-fast",

      memory_compression: "cheap-structured",

      planning: "strong-reasoning",

      codegen: "code-strong",

      verification: "verifier-balanced",

      summarization: "cheap-fast",

      embedding: "embedding",

      general: "balanced",
    };

    this.adapters = new Map();

    const defaults: Partial<Record<ModelProviderId, ModelAdapter>> = {
      openai: new OpenAIAdapter({}),

      anthropic: new AnthropicAdapter({}),

      openrouter: new OpenRouterAdapter({}),

      ...config.adapters,
    };

    for (const [id, adapter] of Object.entries(defaults)) {
      if (adapter) {
        this.adapters.set(id as ModelProviderId, adapter);
      }
    }
  }

  resolveRoute(
    taskType: ReasoningTaskType,
    modelOverride?: string
  ): {
    provider: ModelProviderId;

    model: string;
  } {
    if (modelOverride) {
      if (modelOverride.includes("/")) {
        return { provider: "openrouter", model: modelOverride };
      }

      return { provider: "openrouter", model: modelOverride };
    }

    if (this.defaultModel) {
      const provider = this.defaultProvider ?? "openrouter";

      return { provider, model: this.defaultModel };
    }

    const modelClass = this.routingPolicy[taskType] ?? "balanced";

    const route = MODEL_CLASS_MAP[modelClass];

    if (!route) {
      return { provider: "openrouter", model: "anthropic/claude-sonnet-4" };
    }

    return route;
  }

  getAdapter(provider: ModelProviderId): ModelAdapter {
    const adapter = this.adapters.get(provider);

    if (!adapter) {
      throw new Error(`No adapter registered for provider: ${provider}`);
    }

    return adapter;
  }

  async generate(
    taskType: ReasoningTaskType,

    request: Omit<ModelRequest, "taskType" | "stream" | "jsonMode"> &
      Partial<Pick<ModelRequest, "stream" | "jsonMode" | "requestId" | "projectId">>,

    options?: { modelOverride?: string; securityPolicy?: SecurityPolicy }
  ): Promise<ModelResponse> {
    const { provider, model } = this.resolveRoute(taskType, options?.modelOverride);

    if (options?.securityPolicy?.blockedModels.includes(model)) {
      throw new Error(`Model blocked by security policy: ${model}`);
    }

    if (
      options?.securityPolicy?.allowedProviders.length &&
      !options.securityPolicy.allowedProviders.includes(provider)
    ) {
      throw new Error(`Provider blocked by security policy: ${provider}`);
    }

    const adapter = this.getAdapter(provider);

    const started = Date.now();

    const { requestId, projectId } = request;

    try {
      const response = await adapter.generate({
        stream: false,

        jsonMode: false,

        ...request,

        taskType,

        model,
      });

      await this.audit?.logModelCall({
        requestId,

        projectId,

        provider: response.provider,

        model: response.model,

        taskType,

        promptTokens: response.usage?.promptTokens ?? 0,

        completionTokens: response.usage?.completionTokens ?? 0,

        totalTokens: response.usage?.totalTokens ?? 0,

        latencyMs: Date.now() - started,
      });

      return response;
    } catch (err) {
      await this.audit?.logModelCall({
        requestId,

        projectId,

        provider,

        model,

        taskType,

        promptTokens: 0,

        completionTokens: 0,

        totalTokens: 0,

        latencyMs: Date.now() - started,
      });

      throw err;
    }
  }

  async *stream(
    taskType: ReasoningTaskType,

    request: Omit<ModelRequest, "taskType" | "stream" | "jsonMode"> &
      Partial<Pick<ModelRequest, "stream" | "jsonMode" | "requestId" | "projectId">>,

    options?: { modelOverride?: string }
  ): AsyncIterable<import("@klm/core").ModelChunk> {
    const { provider, model } = this.resolveRoute(taskType, options?.modelOverride);

    const adapter = this.getAdapter(provider);

    const started = Date.now();

    const { requestId, projectId } = request;

    let completionChars = 0;

    try {
      for await (const chunk of adapter.stream({
        stream: true,

        jsonMode: false,

        ...request,

        taskType,

        model,
      })) {
        if (chunk.content) {
          completionChars += chunk.content.length;
        }

        yield chunk;
      }

      const completionTokens = Math.ceil(completionChars / 4);

      await this.audit?.logModelCall({
        requestId,

        projectId,

        provider,

        model,

        taskType,

        promptTokens: 0,

        completionTokens,

        totalTokens: completionTokens,

        latencyMs: Date.now() - started,
      });
    } catch (err) {
      await this.audit?.logModelCall({
        requestId,

        projectId,

        provider,

        model,

        taskType,

        promptTokens: 0,

        completionTokens: 0,

        totalTokens: 0,

        latencyMs: Date.now() - started,
      });

      throw err;
    }
  }
}
