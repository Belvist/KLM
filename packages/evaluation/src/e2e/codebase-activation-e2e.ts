import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { buildGateway } from "@klm/api/gateway";
import { PostgresAuditLogger } from "@klm/audit";
import { CodebaseIndexer } from "@klm/codebase-indexer";
import { createKlmApp, resetKlmAppForTests } from "@klm/bootstrap";
import type { ModelRequest } from "@klm/core";
import { ModelRouter } from "@klm/model-adapters";
import type { EvalResult } from "./helpers.js";
import { E2eMockAdapter } from "./mock-adapter.js";
import { DEMO_IDS, LIVE_IDS, record, tenantHeaders, tenantHeadersForProject } from "./helpers.js";

const PROJECT_A_ONLY_ROUTE = "/ONLY-PROJECT-A-ACTIVATION-MARKER";
const USER_SECRET_MARKER = "sk-e2e-activation-user-leak-7f3a9b2c";
const IGNORED_DIR_FIXTURE = "dist/leak.ts";

class CapturingMockAdapter extends E2eMockAdapter {
  promptSnapshots: string[] = [];

  private capture(messages: ModelRequest["messages"]): void {
    this.promptSnapshots.push(messages.map((m) => m.content).join("\n"));
  }

  override async generate(input: ModelRequest) {
    this.capture(input.messages);
    return super.generate(input);
  }

  override async *stream(input: ModelRequest) {
    this.capture(input.messages);
    yield* super.stream(input);
  }
}

function repoRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
}

function codebaseActivationBlock(compileBlob: string): string {
  const marker = "Indexed codebase context";
  const start = compileBlob.indexOf(marker);
  if (start < 0) {
    return "";
  }
  const rest = compileBlob.slice(start);
  const nextSection = rest.search(/\n\n[A-Z][a-z]+[\s\S]*?:\n/);
  return nextSection > marker.length ? rest.slice(0, nextSection) : rest;
}

function compilePrompt(adapter: CapturingMockAdapter): string {
  return adapter.promptSnapshots.find((snapshot) => snapshot.includes("Project memory:")) ?? "";
}

function countActivationBulletLines(block: string): number {
  return block.split("\n").filter((line) => line.startsWith("- ")).length;
}

async function clearCodeIndex(pool: pg.Pool, projectId: string): Promise<void> {
  await pool.query(`DELETE FROM code_routes WHERE project_id = $1`, [projectId]);
  await pool.query(`DELETE FROM code_symbols WHERE project_id = $1`, [projectId]);
  await pool.query(`DELETE FROM code_dependencies WHERE project_id = $1`, [projectId]);
  await pool.query(`DELETE FROM code_files WHERE project_id = $1`, [projectId]);
}

async function insertProjectAIsolationMarker(pool: pg.Pool, projectId: string): Promise<void> {
  const fileRes = await pool.query<{ id: string }>(
    `INSERT INTO code_files (project_id, relative_path, content_hash, language, line_count)
     VALUES ($1, 'apps/api/src/project-a-only.ts', $2, 'typescript', 1)
     ON CONFLICT (project_id, relative_path)
     DO UPDATE SET content_hash = EXCLUDED.content_hash
     RETURNING id`,
    [projectId, "fixture-project-a-only"]
  );
  const fileId = fileRes.rows[0]?.id;
  if (!fileId) return;

  await pool.query(
    `INSERT INTO code_routes (project_id, file_id, http_method, path, line_number)
     VALUES ($1, $2, 'GET', $3, 1)
     ON CONFLICT DO NOTHING`,
    [projectId, fileId, PROJECT_A_ONLY_ROUTE]
  );
}

async function insertIgnoredDirFixture(pool: pg.Pool, projectId: string): Promise<void> {
  const fileRes = await pool.query<{ id: string }>(
    `INSERT INTO code_files (project_id, relative_path, content_hash, language, line_count)
     VALUES ($1, $2, $3, 'typescript', 1)
     ON CONFLICT (project_id, relative_path)
     DO UPDATE SET content_hash = EXCLUDED.content_hash
     RETURNING id`,
    [projectId, IGNORED_DIR_FIXTURE, "fixture-dist-leak"]
  );
  const fileId = fileRes.rows[0]?.id;
  if (!fileId) return;

  await pool.query(
    `INSERT INTO code_routes (project_id, file_id, http_method, path, line_number)
     VALUES ($1, $2, 'GET', '/dist-leak-route', 1)
     ON CONFLICT DO NOTHING`,
    [projectId, fileId]
  );
}

async function chatOnce(
  connectionString: string,
  headers: Record<string, string>,
  userMessage: string
): Promise<{ statusCode: number; adapter: CapturingMockAdapter }> {
  resetKlmAppForTests();
  const audit = new PostgresAuditLogger(connectionString);
  const adapter = new CapturingMockAdapter();
  const router = new ModelRouter({
    audit,
    adapters: { openai: adapter, openrouter: adapter },
  });
  const klmApp = await createKlmApp({ reset: true, router });
  const { app } = await buildGateway({ klmApp, logger: false });

  const response = await app.inject({
    method: "POST",
    url: "/v1/chat/completions",
    headers,
    payload: {
      model: "klm-auto",
      messages: [{ role: "user", content: userMessage }],
      stream: false,
    },
  });

  await app.close();
  return { statusCode: response.statusCode, adapter };
}

export async function runCodebaseActivationE2e(
  pool: pg.Pool,
  results: EvalResult[]
): Promise<void> {
  const connectionString = process.env.DATABASE_URL!;
  const projectId = DEMO_IDS.project;
  const root = repoRoot();

  await clearCodeIndex(pool, projectId);

  const indexer = new CodebaseIndexer(connectionString);
  try {
    const indexed = await indexer.indexProject({ root, projectId, connectionString });
    record(
      results,
      "codebase-activation-index-setup",
      indexed.filesIndexed >= 20 && indexed.routesIndexed > 0,
      `files=${indexed.filesIndexed} routes=${indexed.routesIndexed}`
    );
  } finally {
    await indexer.close();
  }

  await insertProjectAIsolationMarker(pool, projectId);
  await insertIgnoredDirFixture(pool, projectId);

  const previousActivation = process.env.KLM_CODEBASE_ACTIVATION;
  const previousLimit = process.env.KLM_CODEBASE_ACTIVATION_LIMIT;
  process.env.KLM_CODEBASE_ACTIVATION = "true";

  try {
    const { statusCode, adapter } = await chatOnce(
      connectionString,
      tenantHeaders(),
      "Where is the GET /health API route defined in this codebase?"
    );

    const compileBlob = compilePrompt(adapter);
    const activationBlock = codebaseActivationBlock(compileBlob);

    record(
      results,
      "codebase-activation-injects-context",
      statusCode === 200 &&
        compileBlob.includes("Indexed codebase context") &&
        compileBlob.includes("/health"),
      `status=${statusCode} hasBlock=${compileBlob.includes("Indexed codebase context")} hasHealth=${compileBlob.includes("/health")}`
    );

    record(
      results,
      "codebase-activation-no-secrets-in-prompt",
      !activationBlock.includes("BEGIN RSA PRIVATE KEY") &&
        !activationBlock.includes("OPENAI_API_KEY="),
      "codebase activation block excludes indexed secret markers"
    );

    const hasMetadataOnly =
      activationBlock.includes("metadata only") && !activationBlock.match(/```[\s\S]*?```/);
    record(
      results,
      "codebase-activation-metadata-only-block",
      Boolean(hasMetadataOnly),
      hasMetadataOnly ? "codebase block present without code fences" : "missing metadata block"
    );

    record(
      results,
      "codebase-activation-metadata-no-forbidden-fields",
      !activationBlock.includes("contentHash") &&
        !activationBlock.includes("content_hash") &&
        !activationBlock.includes("signature") &&
        !/"id"\s*:/.test(activationBlock) &&
        !activationBlock.includes("indexedAt"),
      "activation block excludes hash/id/signature/json fields"
    );

    record(
      results,
      "codebase-activation-ignored-dir-excluded",
      !activationBlock.includes(IGNORED_DIR_FIXTURE) &&
        !activationBlock.includes("/dist-leak-route"),
      `activation block excludes ${IGNORED_DIR_FIXTURE}`
    );

    process.env.KLM_CODEBASE_ACTIVATION_LIMIT = "5000";
    const limitRun = await chatOnce(
      connectionString,
      tenantHeaders(),
      "List all API routes and symbols in the codebase"
    );
    const limitBlock = codebaseActivationBlock(compilePrompt(limitRun.adapter));
    const bulletCount = countActivationBulletLines(limitBlock);
    record(
      results,
      "codebase-activation-limit-hard-cap",
      limitRun.statusCode === 200 && bulletCount > 0 && bulletCount <= 100,
      `status=${limitRun.statusCode} bullets=${bulletCount} (max 100)`
    );

    const secretRun = await chatOnce(
      connectionString,
      tenantHeaders(),
      `Find GET /health. My token is ${USER_SECRET_MARKER} do not log it.`
    );
    const secretBlock = codebaseActivationBlock(compilePrompt(secretRun.adapter));
    record(
      results,
      "codebase-activation-no-user-input-leak",
      secretRun.statusCode === 200 && !secretBlock.includes(USER_SECRET_MARKER),
      `user secret in activation block=${secretBlock.includes(USER_SECRET_MARKER)}`
    );

    await clearCodeIndex(pool, LIVE_IDS.project);
    const isolationRun = await chatOnce(
      connectionString,
      tenantHeadersForProject(LIVE_IDS.project),
      `Where is route ${PROJECT_A_ONLY_ROUTE}?`
    );
    const isolationBlock = codebaseActivationBlock(compilePrompt(isolationRun.adapter));
    record(
      results,
      "codebase-activation-project-isolation",
      isolationRun.statusCode === 200 && !isolationBlock.includes(PROJECT_A_ONLY_ROUTE),
      `project B activation block contains A marker=${isolationBlock.includes(PROJECT_A_ONLY_ROUTE)}`
    );

    await clearCodeIndex(pool, projectId);
    const failSoftRun = await chatOnce(
      connectionString,
      tenantHeaders(),
      "Where is GET /health defined?"
    );
    const failSoftBlock = codebaseActivationBlock(compilePrompt(failSoftRun.adapter));
    record(
      results,
      "codebase-activation-fail-soft-empty-index",
      failSoftRun.statusCode === 200 && !failSoftBlock.includes("Indexed codebase context"),
      `status=${failSoftRun.statusCode} blockPresent=${failSoftBlock.includes("Indexed codebase context")}`
    );
  } finally {
    if (previousActivation === undefined) delete process.env.KLM_CODEBASE_ACTIVATION;
    else process.env.KLM_CODEBASE_ACTIVATION = previousActivation;

    if (previousLimit === undefined) delete process.env.KLM_CODEBASE_ACTIVATION_LIMIT;
    else process.env.KLM_CODEBASE_ACTIVATION_LIMIT = previousLimit;
  }

  resetKlmAppForTests();
  delete process.env.KLM_CODEBASE_ACTIVATION;
  delete process.env.KLM_CODEBASE_ACTIVATION_LIMIT;

  const disabledRun = await chatOnce(connectionString, tenantHeaders(), "Where is GET /health?");
  const compileOff = compilePrompt(disabledRun.adapter);
  record(
    results,
    "codebase-activation-disabled-skips-block",
    !compileOff.includes("Indexed codebase context"),
    `activation off → no codebase block (${compileOff.includes("Indexed codebase context")})`
  );
}
