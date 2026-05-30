import { randomUUID } from "node:crypto";
import pg from "pg";
import { buildGateway } from "@klm/api/gateway";
import { PostgresAuditLogger } from "@klm/audit";
import { createKlmApp, resetKlmAppForTests } from "@klm/bootstrap";
import { ModelRouter } from "@klm/model-adapters";
import { PostgreSQLStateStore } from "@klm/state-store";
import { E2eMockAdapter } from "./mock-adapter.js";
import type { EvalResult } from "./helpers.js";
import { DEMO_IDS, record, tenantHeaders } from "./helpers.js";

/**
 * Simulates MCP reading project://state after API writes to PostgreSQL.
 * Uses a separate PostgreSQLStateStore instance (separate pool = separate process).
 */
export async function runMcpSharedStoreE2e(
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

  const marker = `mcp-shared-store-marker-${randomUUID()}`;
  const eventsBefore = await pool.query(
    `SELECT COUNT(*)::int AS c FROM events WHERE project_id = $1`,
    [DEMO_IDS.project]
  );

  const response = await app.inject({
    method: "POST",
    url: "/v1/chat/completions",
    headers: tenantHeaders(),
    payload: {
      model: "klm-auto",
      messages: [{ role: "user", content: marker }],
      stream: false,
    },
  });

  record(
    results,
    "mcp-api-write",
    response.statusCode === 200,
    `API write status=${response.statusCode}`
  );

  await app.close();
  await audit.close();

  // MCP process: fresh store connection, same DATABASE_URL
  const mcpStore = new PostgreSQLStateStore(process.env.DATABASE_URL!);

  try {
    const state = await mcpStore.getProjectState(DEMO_IDS.project);
    const decisions = await mcpStore.getDecisions(DEMO_IDS.project);
    const invariants = await mcpStore.getInvariants(DEMO_IDS.project);
    const events = await mcpStore.getEvents(DEMO_IDS.project, 50);

    record(
      results,
      "mcp-reads-project-state",
      Boolean(state?.name === "KLM Runtime Demo" || state?.name === "KLM Runtime"),
      `state.name=${state?.name ?? "missing"}`
    );

    record(
      results,
      "mcp-reads-seeded-decisions",
      decisions.length >= 2,
      `decisions=${decisions.length}`
    );

    record(
      results,
      "mcp-reads-seeded-invariants",
      invariants.length >= 8,
      `invariants=${invariants.length}`
    );

    const hasCentralizedAuth = decisions.some((d) =>
      d.decision.includes("Auth must be centralized")
    );
    record(
      results,
      "mcp-decisions-match-seed",
      hasCentralizedAuth,
      `centralized auth decision=${hasCentralizedAuth}`
    );

    const eventsAfterCount = await pool.query(
      `SELECT COUNT(*)::int AS c FROM events WHERE project_id = $1`,
      [DEMO_IDS.project]
    );
    const expectedMin = (eventsBefore.rows[0]?.c ?? 0) + 2;
    record(
      results,
      "mcp-sees-api-events",
      (eventsAfterCount.rows[0]?.c ?? 0) >= expectedMin,
      `events=${eventsAfterCount.rows[0]?.c ?? 0} (expected >= ${expectedMin})`
    );

    const sawMarker = events.some((e) => e.content.includes(marker));
    record(
      results,
      "mcp-sees-api-user-message",
      sawMarker,
      `marker found in events=${sawMarker}`
    );

    const sawFeedback = events.some((e) => e.type === "feedback");
    record(
      results,
      "mcp-sees-assistant-feedback",
      sawFeedback,
      `feedback event present=${sawFeedback}`
    );
  } finally {
    await mcpStore.close();
  }
}
