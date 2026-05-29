import type { ModelRequest, ModelResponse } from "@klm/core";
import { BaseModelAdapter } from "./types.js";

interface OpenAIChatResponse {
  choices: Array<{
    message: { content: string | null };
    finish_reason: string;
  }>;
  model: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class OpenAIAdapter extends BaseModelAdapter {
  readonly providerId: import("@klm/core").ModelProviderId = "openai";

  async generate(input: ModelRequest): Promise<ModelResponse> {
    const model = this.resolveModel(input);
    const baseUrl = this.config.baseUrl ?? "https://api.openai.com/v1";
    const apiKey = this.config.apiKey ?? process.env.OPENAI_API_KEY;

    if (!apiKey) {
      throw new Error("OpenAI API key not configured");
    }

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: input.messages,
        temperature: input.temperature ?? 0.2,
        max_tokens: input.maxTokens,
        stream: false,
        response_format: input.jsonMode ? { type: "json_object" } : undefined,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error ${response.status}: ${errorText}`);
    }

    const data = (await response.json()) as OpenAIChatResponse;
    const choice = data.choices[0];

    return {
      content: choice?.message.content ?? "",
      model: data.model,
      provider: this.providerId,
      finishReason: mapFinishReason(choice?.finish_reason),
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens,
            totalTokens: data.usage.total_tokens,
          }
        : undefined,
    };
  }

  async *stream(input: ModelRequest): AsyncIterable<import("@klm/core").ModelChunk> {
    const model = this.resolveModel(input);
    const baseUrl = this.config.baseUrl ?? "https://api.openai.com/v1";
    const apiKey = this.config.apiKey ?? process.env.OPENAI_API_KEY;

    if (!apiKey) {
      throw new Error("OpenAI API key not configured");
    }

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: input.messages,
        temperature: input.temperature ?? 0.2,
        max_tokens: input.maxTokens,
        stream: true,
      }),
    });

    if (!response.ok || !response.body) {
      const errorText = await response.text();
      throw new Error(`OpenAI stream error ${response.status}: ${errorText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;
        const payload = trimmed.slice(6);
        if (payload === "[DONE]") {
          yield { content: "", done: true };
          return;
        }

        try {
          const parsed = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const delta = parsed.choices?.[0]?.delta?.content ?? "";
          if (delta) {
            yield { content: delta, done: false };
          }
        } catch {
          // skip malformed SSE chunks
        }
      }
    }

    yield { content: "", done: true };
  }

  getCostEstimate(input: ModelRequest): import("@klm/core").CostEstimate {
    const promptTokens = estimateTokens(input);
    const completionTokens = input.maxTokens ?? 1024;
    const promptCost = (promptTokens / 1_000_000) * 2.5;
    const completionCost = (completionTokens / 1_000_000) * 10;
    return {
      promptCostUsd: promptCost,
      completionCostUsd: completionCost,
      totalCostUsd: promptCost + completionCost,
    };
  }
}

function mapFinishReason(
  reason?: string
): ModelResponse["finishReason"] {
  switch (reason) {
    case "stop":
      return "stop";
    case "length":
      return "length";
    case "tool_calls":
      return "tool_calls";
    default:
      return "error";
  }
}

function estimateTokens(input: ModelRequest): number {
  return input.messages.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0);
}
