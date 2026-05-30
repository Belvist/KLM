/**
 * Record a demo interaction into PostgreSQL without a real LLM API key.
 */
import { randomUUID } from "node:crypto";
import { PostgresAuditLogger } from "@klm/audit";
import { createKlmApp, resetKlmAppForTests } from "@klm/bootstrap";
import { BaseModelAdapter, ModelRouter } from "@klm/model-adapters";
import type { ModelProviderId, ModelRequest, ModelResponse } from "@klm/core";

class DemoMockAdapter extends BaseModelAdapter {
  readonly providerId: ModelProviderId = "openai";

  constructor() {
    super({});
  }

  async generate(input: ModelRequest): Promise<ModelResponse> {
    const content =
      input.taskType === "intent"
        ? JSON.stringify({
            taskType: "planning",
            outputFormat: "task_plan",
            qualityLevel: "production",
            entities: ["observability", "admin-api"],
            urgency: "normal",
            requiresVerification: true,
          })
        : "Phase 2.3 plan: add GET /v1/admin/model-calls and GET /v1/admin/audit-logs with tenant scoping, pagination, and no secrets in response.";

    return {
      content,
      model: "demo-mock",
      provider: "openai",
      finishReason: "stop",
      usage: { promptTokens: 15, completionTokens: 45, totalTokens: 60 },
    };
  }

  async *stream(_input: ModelRequest): AsyncIterable<import("@klm/core").ModelChunk> {
    yield { content: "demo", done: true };
  }

  getCostEstimate(): import("@klm/core").CostEstimate {
    return { promptCostUsd: 0, completionCostUsd: 0, totalCostUsd: 0 };
  }
}

const DEMO_PROJECT = process.env.KLM_DEMO_PROJECT_ID ?? "00000000-0000-4000-8000-000000000003";
const LIVE_PROJECT = process.env.KLM_LIVE_PROJECT_ID ?? "00000000-0000-4000-8000-000000000005";
const DEMO_ORG = process.env.KLM_DEMO_ORG_ID ?? "00000000-0000-4000-8000-000000000001";
const DEMO_WORKSPACE = process.env.KLM_DEMO_WORKSPACE_ID ?? "00000000-0000-4000-8000-000000000002";
const DEMO_USER = process.env.KLM_DEMO_USER_ID ?? "00000000-0000-4000-8000-000000000004";

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL required");
    process.exit(1);
  }

  resetKlmAppForTests();

  const audit = new PostgresAuditLogger(process.env.DATABASE_URL);
  const router = new ModelRouter({
    audit,
    adapters: { openai: new DemoMockAdapter(), openrouter: new DemoMockAdapter() },
  });

  const { runtime } = await createKlmApp({ reset: true, router });

  const userInput =
    "Record for KLM Runtime: next milestone is Phase 2.3 observability — admin endpoints for model_calls and audit_logs. Must enforce tenant boundary and pagination.";

  const response = await runtime.handleRequest({
    tenant: {
      organizationId: DEMO_ORG,
      workspaceId: DEMO_WORKSPACE,
      projectId: DEMO_PROJECT,
      userId: DEMO_USER,
      requestId: randomUUID(),
    },
    client: "mcp",
    input: userInput,
    stream: false,
  });

  console.log("Recorded demo interaction for project:", DEMO_PROJECT);
  console.log("Output preview:", response.output.slice(0, 120) + "...");
  console.log("memoryUpdated:", response.memoryUpdated);

  await audit.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
