import pg from "pg";
import { buildGateway } from "@klm/api/gateway";
import { PostgresAuditLogger } from "@klm/audit";
import { createKlmApp, resetKlmAppForTests } from "@klm/bootstrap";
import { ModelRouter } from "@klm/model-adapters";
import { COMPILE_OUTPUT, E2eMockAdapter } from "./mock-adapter.js";
import type { EvalResult } from "./helpers.js";
import { DEMO_IDS, parseSseBody, record, tenantHeaders } from "./helpers.js";

export async function runStreamMemoryE2e(pool: pg.Pool, results: EvalResult[]): Promise<void> {
  resetKlmAppForTests();

  const audit = new PostgresAuditLogger(process.env.DATABASE_URL!);
  const router = new ModelRouter({
    audit,
    adapters: { openai: new E2eMockAdapter(), openrouter: new E2eMockAdapter() },
  });
  const klmApp = await createKlmApp({ reset: true, router });
  const { app } = await buildGateway({ klmApp, logger: false });

  const feedbackBefore = await pool.query(
    `SELECT COUNT(*)::int AS c FROM events WHERE project_id = $1 AND type = 'feedback'`,
    [DEMO_IDS.project]
  );
  const modelCallsBefore = await pool.query(`SELECT COUNT(*)::int AS c FROM model_calls`);

  const response = await app.inject({
    method: "POST",
    url: "/v1/chat/completions",
    headers: tenantHeaders(),
    payload: {
      model: "klm-auto",
      stream: true,
      messages: [
        {
          role: "user",
          content: "Stream test: add upload endpoint with auth and rate limit.",
        },
      ],
    },
  });

  const { chunks, done } = parseSseBody(response.body);
  const fullContent = chunks.join("");

  record(
    results,
    "stream-response-received",
    response.statusCode === 200 && fullContent.length > 0,
    `status=${response.statusCode} streamedLen=${fullContent.length}`
  );

  record(results, "stream-done-marker", done, `SSE [DONE] received=${done}`);

  record(
    results,
    "stream-content-matches-compile",
    fullContent.includes("auth") && fullContent.includes(COMPILE_OUTPUT.slice(0, 20)),
    `content preview=${fullContent.slice(0, 60)}`
  );

  const feedbackAfter = await pool.query(
    `SELECT COUNT(*)::int AS c FROM events WHERE project_id = $1 AND type = 'feedback'`,
    [DEMO_IDS.project]
  );
  const newFeedback = (feedbackAfter.rows[0]?.c ?? 0) - (feedbackBefore.rows[0]?.c ?? 0);

  record(
    results,
    "stream-memory-feedback-after-done",
    newFeedback >= 1,
    `new feedback events=${newFeedback} (memory pipeline after stream)`
  );

  const modelCallsAfter = await pool.query(`SELECT COUNT(*)::int AS c FROM model_calls`);
  const newModelCalls = (modelCallsAfter.rows[0]?.c ?? 0) - (modelCallsBefore.rows[0]?.c ?? 0);

  record(
    results,
    "stream-model-call-logged",
    newModelCalls >= 1,
    `new model_calls=${newModelCalls}`
  );

  const latestFeedback = await pool.query(
    `SELECT content FROM events WHERE project_id = $1 AND type = 'feedback'
     ORDER BY timestamp DESC LIMIT 1`,
    [DEMO_IDS.project]
  );
  const savedContent = latestFeedback.rows[0]?.content ?? "";

  record(
    results,
    "stream-feedback-matches-output",
    savedContent.length > 0 && fullContent.length > 0 && savedContent.includes("auth"),
    `saved feedback len=${savedContent.length}`
  );

  await app.close();
  await audit.close();
}
