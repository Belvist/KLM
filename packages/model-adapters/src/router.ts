import type {
  ModelProviderId,
  ModelRequest,
  ModelResponse,
  ReasoningTaskType,
  RoutingPolicy,
  SecurityPolicy,
} from "@klm/core";
import { MODEL_CLASS_MAP } from "@klm/core";
import type { ModelAdapter } from "./types.js";
import { AnthropicAdapter } from "./anthropic-adapter.js";
import { OpenAIAdapter } from "./openai-adapter.js";
import { OpenRouterAdapter } from "./openrouter-adapter.js";

export interface ModelRouterConfig {
  routingPolicy?: RoutingPolicy;
  securityPolicy?: SecurityPolicy;
  adapters?: Partial<Record<ModelProviderId, ModelAdapter>>;
}

export class ModelRouter {
  private adapters: Map<ModelProviderId, ModelAdapter>;
  private routingPolicy: RoutingPolicy;

  constructor(config: ModelRouterConfig = {}) {
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

  resolveRoute(taskType: ReasoningTaskType, modelOverride?: string): {
    provider: ModelProviderId;
    model: string;
  } {
    if (modelOverride) {
      if (modelOverride.includes("/")) {
        return { provider: "openrouter", model: modelOverride };
      }
      return { provider: "openrouter", model: modelOverride };
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
      Partial<Pick<ModelRequest, "stream" | "jsonMode">>,
    options?: { modelOverride?: string; securityPolicy?: SecurityPolicy }
  ): Promise<ModelResponse> {
    const { provider, model } = this.resolveRoute(
      taskType,
      options?.modelOverride
    );

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
    return adapter.generate({
      stream: false,
      jsonMode: false,
      ...request,
      taskType,
      model,
    });
  }

  async *stream(
    taskType: ReasoningTaskType,
    request: Omit<ModelRequest, "taskType">,
    options?: { modelOverride?: string }
  ): AsyncIterable<import("@klm/core").ModelChunk> {
    const { provider, model } = this.resolveRoute(
      taskType,
      options?.modelOverride
    );
    const adapter = this.getAdapter(provider);
    yield* adapter.stream({ ...request, taskType, model });
  }
}
