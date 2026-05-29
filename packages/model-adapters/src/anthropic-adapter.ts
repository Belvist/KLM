import type { ModelRequest, ModelResponse } from "@klm/core";
import { OpenAIAdapter } from "./openai-adapter.js";

export class AnthropicAdapter extends OpenAIAdapter {
  readonly providerId: import("@klm/core").ModelProviderId = "anthropic";

  constructor(config: { apiKey?: string; defaultModel?: string } = {}) {
    super({
      ...config,
      baseUrl: "https://api.anthropic.com/v1",
      defaultModel: config.defaultModel ?? "claude-sonnet-4-20250514",
    });
  }

  override async generate(input: ModelRequest): Promise<ModelResponse> {
    const apiKey = this.config.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("Anthropic API key not configured");
    }

    const response = await super.generate(input);
    return { ...response, provider: "anthropic" };
  }
}
