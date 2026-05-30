import pg from "pg";
import { buildGateway } from "@klm/api/gateway";
import { PostgresAuditLogger, redactPayload, REDACTED_PREVIEW } from "@klm/audit";
import { createKlmApp, resetKlmAppForTests } from "@klm/bootstrap";
import { ModelRouter } from "@klm/model-adapters";
import type { EvalResult } from "./helpers.js";
import { E2eMockAdapter } from "./mock-adapter.js";
import { DEMO_IDS, LIVE_IDS, record, tenantHeaders } from "./helpers.js";

interface PaginatedResponse<T> {
  items: T[];
  nextCursor?: string;
}

export async function runObservabilityE2e(_pool: pg.Pool, results: EvalResult[]): Promise<void> {
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

  const eventsBody = eventsRes.json() as PaginatedResponse<{
    type: string;
    content?: string;
    contentPreview?: string;
    contentLength?: number;
    contentHash?: string;
  }>;
  const eventTypes = new Set(eventsBody.items?.map((e) => e.type) ?? []);
  const hasMessage = eventTypes.has("message");
  const hasFeedback = eventTypes.has("feedback");
  const sampleEvent = eventsBody.items?.find((e) => e.type === "message");

  record(
    results,
    "observability-events",
    eventsRes.statusCode === 200 && hasMessage && hasFeedback,
    `status=${eventsRes.statusCode} types=${[...eventTypes].join(",")}`
  );

  record(
    results,
    "observability-events-content-redacted-by-default",
    Boolean(
      sampleEvent &&
      sampleEvent.content === undefined &&
      typeof sampleEvent.contentPreview === "string" &&
      typeof sampleEvent.contentLength === "number" &&
      typeof sampleEvent.contentHash === "string" &&
      sampleEvent.contentHash.length === 64
    ),
    `message event has preview/length/hash, no full content`
  );

  const eventsFullRes = await app.inject({
    method: "GET",
    url: `/v1/projects/${DEMO_IDS.project}/events?limit=10&includeContent=true`,
    headers: tenantHeaders(),
  });
  const eventsFullBody = eventsFullRes.json() as PaginatedResponse<{ content?: string }>;
  const hasFullContent = eventsFullBody.items?.some(
    (e) => typeof e.content === "string" && e.content.length > 0
  );

  record(
    results,
    "observability-events-include-content-opt-in",
    eventsFullRes.statusCode === 200 && hasFullContent === true,
    `includeContent=true exposes full content=${hasFullContent}`
  );

  process.env.KLM_OBSERVABILITY_REDACT_CONTENT = "true";
  const eventsForcedRes = await app.inject({
    method: "GET",
    url: `/v1/projects/${DEMO_IDS.project}/events?limit=10&includeContent=true`,
    headers: tenantHeaders(),
  });
  delete process.env.KLM_OBSERVABILITY_REDACT_CONTENT;
  const eventsForcedBody = eventsForcedRes.json() as PaginatedResponse<{
    content?: string;
    contentPreview?: string;
  }>;
  const forcedSample = eventsForcedBody.items?.[0];
  const forcedRedacted =
    !eventsForcedBody.items?.some((e) => e.content !== undefined) &&
    forcedSample?.contentPreview === REDACTED_PREVIEW;

  record(
    results,
    "observability-events-force-redact-env",
    eventsForcedRes.statusCode === 200 && forcedRedacted,
    `force-redact: no content, preview=${forcedSample?.contentPreview}`
  );

  const secretMessage = "Use OPENAI_API_KEY=sk-or-v1-e2etestsecret1234567890 for this task.";
  await app.inject({
    method: "POST",
    url: "/v1/chat/completions",
    headers: tenantHeaders(),
    payload: {
      model: "klm-auto",
      messages: [{ role: "user", content: secretMessage }],
      stream: false,
    },
  });

  const secretEventsRes = await app.inject({
    method: "GET",
    url: `/v1/projects/${DEMO_IDS.project}/events?limit=5`,
    headers: tenantHeaders(),
  });
  const secretEventsBody = secretEventsRes.json() as PaginatedResponse<{ contentPreview?: string }>;
  const secretPreview = secretEventsBody.items?.find((e) =>
    e.contentPreview?.includes("OPENAI_API_KEY")
  )?.contentPreview;
  const previewSanitized =
    !secretPreview?.includes("sk-or-v1") && !secretPreview?.includes("e2etestsecret");

  record(
    results,
    "observability-events-preview-secret-sanitized",
    secretEventsRes.statusCode === 200 && previewSanitized,
    `preview leaks secret=${!previewSanitized}`
  );

  const nestedRedacted = redactPayload({
    headers: [[{ authorization: "Bearer nested-secret" }]],
  }) as { headers: Array<Array<{ authorization: string }>> };

  record(
    results,
    "observability-redact-payload-nested-arrays",
    nestedRedacted.headers[0]?.[0]?.authorization === "[redacted]",
    `nested array secrets redacted=${nestedRedacted.headers[0]?.[0]?.authorization === "[redacted]"}`
  );

  const arrayRedacted = redactPayload({
    headers: [{ authorization: "Bearer secret-token" }],
  }) as { headers: Array<{ authorization: string }> };

  record(
    results,
    "observability-redact-payload-arrays",
    arrayRedacted.headers[0]?.authorization === "[redacted]",
    `flat array secrets redacted=${arrayRedacted.headers[0]?.authorization === "[redacted]"}`
  );

  const modelCallsRes = await app.inject({
    method: "GET",
    url: "/v1/admin/model-calls?limit=50",
    headers: tenantHeaders(),
  });

  const modelCallsBody = modelCallsRes.json() as PaginatedResponse<{
    model: string;
    taskType: string;
  }>;

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
    `status=${chunksRes.statusCode} count=${chunksBody.items?.length ?? 0} (content redaction tested in semantic-memory e2e)`
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
