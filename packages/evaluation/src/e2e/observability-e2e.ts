import pg from "pg";
import { buildGateway } from "@klm/api/gateway";
import { PostgresAuditLogger } from "@klm/audit";
import { createKlmApp, resetKlmAppForTests } from "@klm/bootstrap";
import { ModelRouter } from "@klm/model-adapters";
import type { EvalResult } from "./helpers.js";
import { E2eMockAdapter } from "./mock-adapter.js";
import { DEMO_IDS, LIVE_IDS, record, tenantHeaders } from "./helpers.js";

interface PaginatedResponse<T> {
  items: T[];
  nextCursor?: string;
}

export async function runObservabilityE2e(
  _pool: pg.Pool,
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

  const userMessage = "Observability e2e: verify events, model-calls, audit-logs endpoints.";

  const chatRes = await app.inject({
    method: "POST",
    url: "/v1/chat/completions",
    headers: tenantHeaders(),
    payload: {
      model: "klm-auto",
      messages: [{ role: "user", content: userMessage }],
      stream: false,
    },
  });

  record(
    results,
    "observability-chat-setup",
    chatRes.statusCode === 200,
    `chat status=${chatRes.statusCode}`
  );

  const eventsRes = await app.inject({
    method: "GET",
    url: `/v1/projects/${DEMO_IDS.project}/events?limit=50`,
    headers: tenantHeaders(),
  });

  const eventsBody = eventsRes.json() as PaginatedResponse<{ type: string; content: string }>;
  const eventTypes = new Set(eventsBody.items?.map((e) => e.type) ?? []);
  const hasMessage = eventTypes.has("message");
  const hasFeedback = eventTypes.has("feedback");

  record(
    results,
    "observability-events",
    eventsRes.statusCode === 200 && hasMessage && hasFeedback,
    `status=${eventsRes.statusCode} types=${[...eventTypes].join(",")}`
  );

  const modelCallsRes = await app.inject({
    method: "GET",
    url: "/v1/admin/model-calls?limit=50",
    headers: tenantHeaders(),
  });

  const modelCallsBody = modelCallsRes.json() as PaginatedResponse<{ model: string; taskType: string }>;

  record(
    results,
    "observability-model-calls",
    modelCallsRes.statusCode === 200 && (modelCallsBody.items?.length ?? 0) >= 1,
    `status=${modelCallsRes.statusCode} count=${modelCallsBody.items?.length ?? 0}`
  );

  const auditRes = await app.inject({
    method: "GET",
    url: "/v1/admin/audit-logs?limit=50",
    headers: tenantHeaders(),
  });

  const auditBody = auditRes.json() as PaginatedResponse<{ action: string }>;

  record(
    results,
    "observability-audit-logs",
    auditRes.statusCode === 200 && (auditBody.items?.length ?? 0) >= 1,
    `status=${auditRes.statusCode} count=${auditBody.items?.length ?? 0}`
  );

  const chunksRes = await app.inject({
    method: "GET",
    url: `/v1/projects/${DEMO_IDS.project}/memory-chunks?limit=50`,
    headers: tenantHeaders(),
  });

  const chunksBody = chunksRes.json() as PaginatedResponse<unknown>;

  record(
    results,
    "observability-memory-chunks",
    chunksRes.statusCode === 200 && Array.isArray(chunksBody.items),
    `status=${chunksRes.statusCode} count=${chunksBody.items?.length ?? 0}`
  );

  const wrongProjectRes = await app.inject({
    method: "GET",
    url: `/v1/projects/${LIVE_IDS.project}/events?limit=10`,
    headers: tenantHeaders(),
  });

  record(
    results,
    "observability-tenant-boundary-url",
    wrongProjectRes.statusCode === 403,
    `cross-project GET events status=${wrongProjectRes.statusCode} (expected 403)`
  );

  const wrongAdminRes = await app.inject({
    method: "GET",
    url: `/v1/admin/model-calls?projectId=${LIVE_IDS.project}&limit=10`,
    headers: tenantHeaders(),
  });

  record(
    results,
    "observability-tenant-boundary-admin",
    wrongAdminRes.statusCode === 403,
    `cross-project admin model-calls status=${wrongAdminRes.statusCode} (expected 403)`
  );

  const limitRes = await app.inject({
    method: "GET",
    url: `/v1/projects/${DEMO_IDS.project}/events?limit=200`,
    headers: tenantHeaders(),
  });

  const limitBody = limitRes.json() as PaginatedResponse<unknown>;

  record(
    results,
    "observability-limit-cap",
    limitRes.statusCode === 200 && (limitBody.items?.length ?? 0) <= 100,
    `requested 200, returned ${limitBody.items?.length ?? 0} (max 100)`
  );

  await app.close();
  await audit.close();
}
