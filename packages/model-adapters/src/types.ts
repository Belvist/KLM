import type {
  CostEstimate,
  ModelCapability,
  ModelChunk,
  ModelProviderId,
  ModelRequest,
  ModelResponse,
} from "@klm/core";

export interface ModelAdapterConfig {
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
  /** Extra HTTP headers (e.g. OpenRouter HTTP-Referer, X-Title) */
  extraHeaders?: Record<string, string>;
}

export interface ModelAdapter {
  readonly providerId: ModelProviderId;
  getCapabilities(model: string): ModelCapability;
  generate(input: ModelRequest): Promise<ModelResponse>;
  stream(input: ModelRequest): AsyncIterable<ModelChunk>;
  getCostEstimate(input: ModelRequest): CostEstimate;
}

export abstract class BaseModelAdapter implements ModelAdapter {
  abstract readonly providerId: ModelProviderId;

  constructor(protected config: ModelAdapterConfig) {}

  abstract generate(input: ModelRequest): Promise<ModelResponse>;
  abstract stream(input: ModelRequest): AsyncIterable<ModelChunk>;
  abstract getCostEstimate(input: ModelRequest): CostEstimate;

  getCapabilities(_model: string): ModelCapability {
    return {
      tools: true,
      vision: false,
      longContext: true,
      structuredOutput: true,
      streaming: true,
    };
  }

  protected resolveModel(input: ModelRequest): string {
    return input.model ?? this.config.defaultModel ?? "default";
  }
}
