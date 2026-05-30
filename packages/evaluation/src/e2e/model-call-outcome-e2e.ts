import { randomUUID } from "node:crypto";
import pg from "pg";
import { buildGateway } from "@klm/api/gateway";
import { PostgresAuditLogger } from "@klm/audit";
import { createKlmApp, resetKlmAppForTests } from "@klm/bootstrap";
import type { ModelProviderId, ModelRequest, ModelResponse } from "@klm/core";
import { ModelRouter } from "@klm/model-adapters";
import type { EvalResult } from "./helpers.js";
import { E2eMockAdapter } from "./mock-adapter.js";
import { DEMO_IDS, record, tenantHeaders } from "./helpers.js";

class FailingGenerateAdapter extends E2eMockAdapter {
  readonly providerId: ModelProviderId = "openai";

  async generate(_input: ModelRequest): Promise<ModelResponse> {
    throw new Error("Provider error: HTTP 503 service unavailable");
  }
}

class FailingStreamAdapter extends E2eMockAdapter {
  readonly providerId: ModelProviderId = "openai";

  async *stream(_input: ModelRequest): AsyncIterable<import("@klm/core").ModelChunk> {
    throw new Error("Stream interrupted: connection reset");
  }
}

export async function runModelCallOutcomeE2e(pool: pg.Pool, results: EvalResult[]): Promise<void> {
  const audit = new PostgresAuditLogger(process.env.DATABASE_URL!);

  // --- failed generate ---
  const failGenRequestId = randomUUID();
  const failGenRouter = new ModelRouter({
    audit,
    adapters: { openai: new FailingGenerateAdapter(), openrouter: new FailingGenerateAdapter() },
  });

  let generateThrew = false;
  try {
    await failGenRouter.generate("general", {
      messages: [{ role: "user", content: "fail generate test" }],
      requestId: failGenRequestId,
      projectId: DEMO_IDS.project,
    });
  } catch {
    generateThrew = true;
  }

  const failGenRow = await pool.query<{
    outcome: string;
    error_message: string | null;
    total_tokens: number;
  }>(`SELECT outcome, error_message, total_tokens FROM model_calls WHERE request_id = $1`, [
    failGenRequestId,
  ]);

  record(
    results,
    "model-call-failed-generate-throws",
    generateThrew,
    `generate threw=${generateThrew}`
  );

  record(
    results,
    "model-call-failed-generate-outcome",
    failGenRow.rows[0]?.outcome === "error" &&
      Boolean(failGenRow.rows[0]?.error_message?.includes("503")),
    `outcome=${failGenRow.rows[0]?.outcome} message=${failGenRow.rows[0]?.error_message?.slice(0, 40)}`
  );

  // --- failed stream ---
  const failStreamRequestId = randomUUID();
  const failStreamRouter = new ModelRouter({
    audit,
    adapters: { openai: new FailingStreamAdapter(), openrouter: new FailingStreamAdapter() },
  });

  let streamThrew = false;
  try {
    for await (const _chunk of failStreamRouter.stream("general", {
      messages: [{ role: "user", content: "fail stream test" }],
      requestId: failStreamRequestId,
      projectId: DEMO_IDS.project,
    })) {
      // consume
    }
  } catch {
    streamThrew = true;
  }

  const failStreamRow = await pool.query<{ outcome: string; error_message: string | null }>(
    `SELECT outcome, error_message FROM model_calls WHERE request_id = $1`,
    [failStreamRequestId]
  );

  record(results, "model-call-failed-stream-throws", streamThrew, `stream threw=${streamThrew}`);

  record(
    results,
    "model-call-failed-stream-outcome",
    failStreamRow.rows[0]?.outcome === "error" &&
      Boolean(failStreamRow.rows[0]?.error_message?.includes("connection reset")),
    `outcome=${failStreamRow.rows[0]?.outcome} message=${failStreamRow.rows[0]?.error_message?.slice(0, 40)}`
  );

  // --- observability API exposes outcome ---
  resetKlmAppForTests();
  const okRouter = new ModelRouter({
    audit,
    adapters: { openai: new E2eMockAdapter(), openrouter: new E2eMockAdapter() },
  });
  const klmApp = await createKlmApp({ reset: true, router: okRouter });
  const { app } = await buildGateway({ klmApp, logger: false });

  await app.inject({
    method: "POST",
    url: "/v1/chat/completions",
    headers: tenantHeaders(),
    payload: {
      model: "klm-auto",
      messages: [{ role: "user", content: "model-call outcome success path" }],
      stream: false,
    },
  });

  const adminRes = await app.inject({
    method: "GET",
    url: "/v1/admin/model-calls?limit=10",
    headers: tenantHeaders(),
  });

  const adminBody = adminRes.json() as {
    items?: Array<{ outcome?: string; errorMessage?: string }>;
  };
  const hasSuccessOutcome = adminBody.items?.some((c) => c.outcome === "success");

  record(
    results,
    "model-call-observability-outcome-field",
    adminRes.statusCode === 200 && hasSuccessOutcome === true,
    `admin model-calls includes outcome=success=${hasSuccessOutcome}`
  );

  const errorViaApi = adminBody.items?.find((c) => c.outcome === "error");
  record(
    results,
    "model-call-observability-error-visible",
    Boolean(errorViaApi?.errorMessage),
    `error call visible in admin API=${Boolean(errorViaApi?.errorMessage)}`
  );

  await app.close();
  await audit.close();
}
