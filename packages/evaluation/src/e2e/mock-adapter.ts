import { BaseModelAdapter } from "@klm/model-adapters";
import type { ModelProviderId, ModelRequest, ModelResponse } from "@klm/core";

const INTENT_JSON = {
  taskType: "code",
  outputFormat: "mixed",
  qualityLevel: "production",
  entities: ["endpoint", "auth", "rate limit"],
  urgency: "normal",
  requiresVerification: true,
};

const COMPILE_OUTPUT =
  "Endpoint includes auth middleware, rate limit, audit logging, and S3 storage flow.";

export class E2eMockAdapter extends BaseModelAdapter {
  readonly providerId: ModelProviderId = "openai";

  constructor() {
    super({});
  }

  async generate(input: ModelRequest): Promise<ModelResponse> {
    let content = COMPILE_OUTPUT;

    if (input.jsonMode) {
      if (input.taskType === "intent") {
        content = JSON.stringify(INTENT_JSON);
      } else if (input.taskType === "memory_compression") {
        content = "{}";
      } else {
        content = "{}";
      }
    }

    return {
      content,
      model: "e2e-mock",
      provider: "openai",
      finishReason: "stop",
      usage: { promptTokens: 12, completionTokens: 24, totalTokens: 36 },
    };
  }

  async *stream(_input: ModelRequest): AsyncIterable<import("@klm/core").ModelChunk> {
    yield { content: COMPILE_OUTPUT, done: false };
    yield { content: "", done: true };
  }

  getCostEstimate(): import("@klm/core").CostEstimate {
    return { promptCostUsd: 0, completionCostUsd: 0, totalCostUsd: 0 };
  }
}

export { COMPILE_OUTPUT };
