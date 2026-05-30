import type { ModelRequest, ModelResponse } from "@klm/core";
import { OpenAIAdapter } from "./openai-adapter.js";

/**
 * OpenRouter normalizes multiple providers behind an OpenAI-compatible API.
 * @see https://openrouter.ai/docs
 */
export class OpenRouterAdapter extends OpenAIAdapter {
  readonly providerId: import("@klm/core").ModelProviderId = "openrouter";

  constructor(config: { apiKey?: string; defaultModel?: string } = {}) {
    const apiKey = config.apiKey ?? process.env.OPENROUTER_API_KEY;
    super({
      apiKey,
      baseUrl: "https://openrouter.ai/api/v1",
      defaultModel: config.defaultModel ?? "anthropic/claude-sonnet-4",
      extraHeaders: {
        "HTTP-Referer":
          process.env.KLM_APP_URL ?? process.env.APP_URL ?? "https://github.com/Belvist/KLM",
        "X-Title": process.env.KLM_APP_NAME ?? "KLM Runtime",
      },
    });
  }

  override async generate(input: ModelRequest): Promise<ModelResponse> {
    if (!this.config.apiKey) {
      throw new Error("OpenRouter API key not configured (OPENROUTER_API_KEY)");
    }

    const response = await super.generate({
      ...input,
      model: input.model ?? this.config.defaultModel,
    });

    return { ...response, provider: "openrouter" };
  }
}
