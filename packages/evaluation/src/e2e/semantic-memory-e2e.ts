import pg from "pg";
import { buildGateway } from "@klm/api/gateway";
import { PostgresAuditLogger, REDACTED_PREVIEW } from "@klm/audit";
import { createKlmApp, resetKlmAppForTests } from "@klm/bootstrap";
import { ModelRouter } from "@klm/model-adapters";
import { PgVectorMemoryIndex } from "@klm/semantic-memory";
import type { EvalResult } from "./helpers.js";
import { E2eMockAdapter } from "./mock-adapter.js";
import { DEMO_IDS, record, tenantHeaders } from "./helpers.js";

interface PaginatedResponse<T> {
  items: T[];
  nextCursor?: string;
}

interface ChunkItem {
  content?: string;
  contentPreview?: string;
  contentLength?: number;
  contentHash?: string;
  sourceId?: string;
}

export async function runSemanticMemoryE2e(pool: pg.Pool, results: EvalResult[]): Promise<void> {
  const prevSemantic = process.env.KLM_SEMANTIC_MEMORY;
  const prevProvider = process.env.KLM_EMBEDDING_PROVIDER;
  process.env.KLM_SEMANTIC_MEMORY = "true";
  process.env.KLM_EMBEDDING_PROVIDER = "mock";

  resetKlmAppForTests();

  const audit = new PostgresAuditLogger(process.env.DATABASE_URL!);
  const router = new ModelRouter({
    audit,
    adapters: { openai: new E2eMockAdapter(), openrouter: new E2eMockAdapter() },
  });
  const klmApp = await createKlmApp({ reset: true, router });
  const { app } = await buildGateway({ klmApp, logger: false });
  const index = new PgVectorMemoryIndex(process.env.DATABASE_URL!);

  const chunksBefore = await index.countChunks(DEMO_IDS.project);

  const chatRes = await app.inject({
    method: "POST",
    url: "/v1/chat/completions",
    headers: tenantHeaders(),
    payload: {
      model: "klm-auto",
      messages: [
        {
          role: "user",
          content: "Semantic e2e: index project invariants and events into memory_chunks.",
        },
      ],
      stream: false,
    },
  });

  record(
    results,
    "semantic-runtime-chat",
    chatRes.statusCode === 200,
    `chat status=${chatRes.statusCode}`
  );

  const chunksAfter = await index.countChunks(DEMO_IDS.project);
  const newChunks = chunksAfter - chunksBefore;

  record(
    results,
    "semantic-runtime-creates-chunks",
    newChunks > 0,
    `new memory_chunks=${newChunks} total=${chunksAfter}`
  );

  const invariantRow = await pool.query<{ source_id: string }>(
    `SELECT source_id FROM memory_chunks
     WHERE project_id = $1 AND chunk_type = 'invariant'
     LIMIT 1`,
    [DEMO_IDS.project]
  );
  const invariantSourceId = invariantRow.rows[0]?.source_id;

  const chatRes2 = await app.inject({
    method: "POST",
    url: "/v1/chat/completions",
    headers: tenantHeaders(),
    payload: {
      model: "klm-auto",
      messages: [{ role: "user", content: "Second semantic e2e request — re-index same project." }],
      stream: false,
    },
  });

  record(
    results,
    "semantic-runtime-second-chat",
    chatRes2.statusCode === 200,
    `second chat status=${chatRes2.statusCode}`
  );

  if (invariantSourceId) {
    const dedupCount = await index.countChunks(DEMO_IDS.project, invariantSourceId);
    record(
      results,
      "semantic-runtime-chunk-dedup",
      dedupCount === 1,
      `invariant sourceId chunks=${dedupCount} (expected 1)`
    );
  } else {
    record(
      results,
      "semantic-runtime-chunk-dedup",
      false,
      "no invariant chunk found to verify dedup"
    );
  }

  const chunksRes = await app.inject({
    method: "GET",
    url: `/v1/projects/${DEMO_IDS.project}/memory-chunks?limit=20`,
    headers: tenantHeaders(),
  });
  const chunksBody = chunksRes.json() as PaginatedResponse<ChunkItem>;
  const sampleChunk = chunksBody.items?.[0];

  record(
    results,
    "observability-memory-chunks-content-redacted-by-default",
    Boolean(
      chunksRes.statusCode === 200 &&
      (chunksBody.items?.length ?? 0) > 0 &&
      sampleChunk &&
      sampleChunk.content === undefined &&
      typeof sampleChunk.contentPreview === "string" &&
      typeof sampleChunk.contentHash === "string"
    ),
    `chunks=${chunksBody.items?.length ?? 0} preview without full content`
  );

  const chunksFullRes = await app.inject({
    method: "GET",
    url: `/v1/projects/${DEMO_IDS.project}/memory-chunks?limit=10&includeContent=true`,
    headers: tenantHeaders(),
  });
  const chunksFullBody = chunksFullRes.json() as PaginatedResponse<ChunkItem>;
  const hasChunkContent = chunksFullBody.items?.some(
    (c) => typeof c.content === "string" && c.content.length > 0
  );

  record(
    results,
    "observability-memory-chunks-include-content-opt-in",
    chunksFullRes.statusCode === 200 && hasChunkContent === true,
    `includeContent=true on memory-chunks=${hasChunkContent}`
  );

  process.env.KLM_OBSERVABILITY_REDACT_CONTENT = "true";
  const chunksForcedRes = await app.inject({
    method: "GET",
    url: `/v1/projects/${DEMO_IDS.project}/memory-chunks?limit=10&includeContent=true`,
    headers: tenantHeaders(),
  });
  delete process.env.KLM_OBSERVABILITY_REDACT_CONTENT;
  const chunksForcedBody = chunksForcedRes.json() as PaginatedResponse<ChunkItem>;
  const forcedChunk = chunksForcedBody.items?.[0];
  const forceRedacted =
    !chunksForcedBody.items?.some((c) => c.content !== undefined) &&
    forcedChunk?.contentPreview === REDACTED_PREVIEW;

  record(
    results,
    "observability-memory-chunks-force-redact-env",
    chunksForcedRes.statusCode === 200 && forceRedacted,
    `force-redact preview=${forcedChunk?.contentPreview}`
  );

  await app.close();
  await audit.close();
  await index.close();

  if (prevSemantic === undefined) delete process.env.KLM_SEMANTIC_MEMORY;
  else process.env.KLM_SEMANTIC_MEMORY = prevSemantic;
  if (prevProvider === undefined) delete process.env.KLM_EMBEDDING_PROVIDER;
  else process.env.KLM_EMBEDDING_PROVIDER = prevProvider;
}
