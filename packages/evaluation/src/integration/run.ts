import { randomUUID } from "node:crypto";
import pg from "pg";
import { PostgresAuditLogger } from "@klm/audit";
import { BaseModelAdapter, ModelRouter } from "@klm/model-adapters";
import type { ModelProviderId, ModelRequest, ModelResponse } from "@klm/core";
import { PgVectorMemoryIndex } from "@klm/semantic-memory";
import { PostgreSQLStateStore } from "@klm/state-store";

const DATABASE_URL = process.env.DATABASE_URL;

interface EvalResult {
  name: string;
  passed: boolean;
  message: string;
}

const results: EvalResult[] = [];

function record(name: string, passed: boolean, message: string): void {
  results.push({ name, passed, message });
}

class MockAdapter extends BaseModelAdapter {
  readonly providerId: ModelProviderId = "openai";

  constructor() {
    super({});
  }

  async generate(_input: ModelRequest): Promise<ModelResponse> {
    return {
      content: "mock-response",
      model: "mock-model",
      provider: "openai",
      finishReason: "stop",
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    };
  }

  async *stream(_input: ModelRequest): AsyncIterable<import("@klm/core").ModelChunk> {
    yield { content: "mock", done: false };
    yield { content: "", done: true };
  }

  getCostEstimate(): import("@klm/core").CostEstimate {
    return { promptCostUsd: 0, completionCostUsd: 0, totalCostUsd: 0 };
  }
}

async function tableExists(pool: pg.Pool, table: string): Promise<boolean> {
  const res = await pool.query(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = $1
    ) AS exists`,
    [table]
  );
  return Boolean(res.rows[0]?.exists);
}

async function main(): Promise<void> {
  if (!DATABASE_URL) {
    console.error("DATABASE_URL required for integration evals");
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: DATABASE_URL });

  try {
    const hasProjectStates = await tableExists(pool, "project_states");
    const hasMemoryChunks = await tableExists(pool, "memory_chunks");
    const hasAuditLogs = await tableExists(pool, "audit_logs");
    const hasModelCalls = await tableExists(pool, "model_calls");
    const hasMigrations = await tableExists(pool, "schema_migrations");

    record(
      "postgres-migrations-applied",
      hasProjectStates && hasMemoryChunks && hasAuditLogs && hasModelCalls && hasMigrations,
      `tables: project_states=${hasProjectStates} memory_chunks=${hasMemoryChunks} audit=${hasAuditLogs} model_calls=${hasModelCalls}`
    );

    const projectId = process.env.KLM_DEMO_PROJECT_ID ?? "00000000-0000-4000-8000-000000000003";
    const store = new PostgreSQLStateStore(DATABASE_URL);
    const state = await store.getProjectState(projectId);

    record(
      "seed-project-exists",
      Boolean(state?.invariants?.length && state?.invariants.length >= 8 && state?.decisions?.length),
      state
        ? `invariants=${state.invariants.length} decisions=${state.decisions.length}`
        : "no project — run pnpm db:seed"
    );

    const index = new PgVectorMemoryIndex(DATABASE_URL);
    const sourceId = randomUUID();
    const embedding = Array.from({ length: 1536 }, (_, i) => (i % 10) * 0.01);

    await index.upsertChunk({
      projectId,
      chunkType: "decision",
      sourceId,
      content: "Auth must be centralized v1",
      embedding,
    });
    await index.upsertChunk({
      projectId,
      chunkType: "decision",
      sourceId,
      content: "Auth must be centralized v2",
      embedding,
    });

    const chunkCount = await index.countChunks(projectId, sourceId);
    record(
      "semantic-upsert-dedup",
      chunkCount === 1,
      `chunks for source=${chunkCount} (expected 1)`
    );

    const audit = new PostgresAuditLogger(DATABASE_URL);
    const requestId = randomUUID();
    await audit.log({
      organizationId: "00000000-0000-4000-8000-000000000001",
      workspaceId: "00000000-0000-4000-8000-000000000002",
      projectId,
      userId: "00000000-0000-4000-8000-000000000004",
      requestId,
      action: "integration-test",
      resource: "eval",
      outcome: "success",
      payload: { test: true },
    });

    const auditCount = await pool.query(
      `SELECT COUNT(*)::int AS c FROM audit_logs WHERE request_id = $1`,
      [requestId]
    );
    record(
      "audit-log-created",
      (auditCount.rows[0]?.c ?? 0) >= 1,
      `audit rows=${auditCount.rows[0]?.c ?? 0}`
    );

    const auditLogger = new PostgresAuditLogger(DATABASE_URL);
    const router = new ModelRouter({
      audit: auditLogger,
      adapters: { openai: new MockAdapter() },
    });

    await router.generate("intent", {
      messages: [{ role: "user", content: "test" }],
      requestId,
      projectId,
    });

    const streamRequestId = randomUUID();
    let streamed = "";
    for await (const chunk of router.stream("general", {
      messages: [{ role: "user", content: "stream test" }],
      requestId: streamRequestId,
      projectId,
    })) {
      if (chunk.content) streamed += chunk.content;
    }

    const modelCallCount = await pool.query(
      `SELECT COUNT(*)::int AS c FROM model_calls WHERE request_id = $1`,
      [requestId]
    );
    record(
      "model-call-created",
      (modelCallCount.rows[0]?.c ?? 0) >= 1,
      `model_calls=${modelCallCount.rows[0]?.c ?? 0}`
    );

    const streamCallCount = await pool.query(
      `SELECT COUNT(*)::int AS c FROM model_calls WHERE request_id = $1`,
      [streamRequestId]
    );
    record(
      "model-call-stream-logged",
      (streamCallCount.rows[0]?.c ?? 0) >= 1 && streamed.length > 0,
      `stream model_calls=${streamCallCount.rows[0]?.c ?? 0} chars=${streamed.length}`
    );

    await index.close();
    await store.close();
    await audit.close();
    await auditLogger.close();
  } finally {
    await pool.end();
  }

  console.log("\nKLM Integration Evaluation\n" + "=".repeat(40));
  let failed = 0;
  for (const r of results) {
    console.log(`${r.passed ? "PASS" : "FAIL"}  ${r.name}`);
    console.log(`      ${r.message}`);
    if (!r.passed) failed++;
  }
  console.log("=".repeat(40));
  console.log(`${results.length - failed}/${results.length} passed\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
