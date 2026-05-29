import pg from "pg";
import { buildGateway } from "@klm/api/gateway";
import { PostgresAuditLogger } from "@klm/audit";
import { createKlmApp, resetKlmAppForTests } from "@klm/bootstrap";
import { ModelRouter } from "@klm/model-adapters";
import type { EvalResult } from "./helpers.js";
import { E2eMockAdapter } from "./mock-adapter.js";
import { DEMO_IDS, record, tenantHeaders } from "./helpers.js";

export async function runHttpApiE2e(
  pool: pg.Pool,
  results: EvalResult[]
): Promise<void> {
  resetKlmAppForTests();

  const audit = new PostgresAuditLogger(process.env.DATABASE_URL!);
  const router = new ModelRouter({
    audit,
    adapters: { openai: new E2eMockAdapter(), openrouter: new E2eMockAdapter() },
  });
  const klmApp = await createKlmApp({ reset: true, router });
  const { app } = await buildGateway({ klmApp, logger: false });

  const eventsBefore = await pool.query(
    `SELECT COUNT(*)::int AS c FROM events WHERE project_id = $1`,
    [DEMO_IDS.project]
  );
  const modelCallsBefore = await pool.query(`SELECT COUNT(*)::int AS c FROM model_calls`);
  const auditBefore = await pool.query(`SELECT COUNT(*)::int AS c FROM audit_logs`);

  const userMessage =
    "Add track upload endpoint. Verify auth, rate limit, audit, and storage flow.";

  const response = await app.inject({
    method: "POST",
    url: "/v1/chat/completions",
    headers: tenantHeaders(),
    payload: {
      model: "klm-auto",
      messages: [{ role: "user", content: userMessage }],
      stream: false,
    },
  });

  const body = response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const output = body.choices?.[0]?.message?.content ?? "";

  record(
    results,
    "http-api-response",
    response.statusCode === 200 && output.length > 0,
    `status=${response.statusCode} outputLen=${output.length}`
  );

  const eventsAfter = await pool.query(
    `SELECT COUNT(*)::int AS c FROM events WHERE project_id = $1`,
    [DEMO_IDS.project]
  );
  const newEvents = (eventsAfter.rows[0]?.c ?? 0) - (eventsBefore.rows[0]?.c ?? 0);

  record(
    results,
    "http-api-events-saved",
    newEvents >= 2,
    `new events=${newEvents} (expected user + assistant feedback)`
  );

  const modelCallsAfter = await pool.query(`SELECT COUNT(*)::int AS c FROM model_calls`);
  const newModelCalls =
    (modelCallsAfter.rows[0]?.c ?? 0) - (modelCallsBefore.rows[0]?.c ?? 0);

  record(
    results,
    "http-api-model-calls",
    newModelCalls >= 1,
    `new model_calls=${newModelCalls}`
  );

  const auditAfter = await pool.query(`SELECT COUNT(*)::int AS c FROM audit_logs`);
  const newAudit = (auditAfter.rows[0]?.c ?? 0) - (auditBefore.rows[0]?.c ?? 0);

  record(
    results,
    "http-api-audit-logs",
    newAudit >= 1,
    `new audit_logs=${newAudit}`
  );

  const stateRes = await app.inject({
    method: "GET",
    url: `/v1/projects/${DEMO_IDS.project}/state`,
    headers: tenantHeaders(),
  });

  record(
    results,
    "http-api-project-state",
    stateRes.statusCode === 200,
    `GET state status=${stateRes.statusCode}`
  );

  await app.close();
  await audit.close();
}
