import type { ModelRequest, ModelResponse } from "@klm/core";
import { OpenAIAdapter } from "./openai-adapter.js";

/**
 * OpenRouter normalizes multiple providers behind an OpenAI-compatible API.
 * @see https://openrouter.ai/docs
 */
export class OpenRouterAdapter extends OpenAIAdapter {
  readonly providerId: import("@klm/core").ModelProviderId = "openrouter";

  constructor(config: { apiKey?: string; defaultModel?: string } = {}) {
    super({
      ...config,
      baseUrl: "https://openrouter.ai/api/v1",
      defaultModel: config.defaultModel ?? "anthropic/claude-sonnet-4",
    });
  }

  override async generate(input: ModelRequest): Promise<ModelResponse> {
    const apiKey = this.config.apiKey ?? process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error("OpenRouter API key not configured");
    }

    const response = await super.generate({
      ...input,
      model: input.model ?? this.config.defaultModel,
    });

    return {
      ...response,
      provider: "openrouter",
    };
  }
}
