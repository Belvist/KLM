import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import {
  CodebaseIndexer,
  countIndexedFiles,
  countSemanticCodeChunks,
  DEFAULT_MAX_FILE_BYTES,
  hasIgnoredPathIndexed,
  hasSecretPathIndexed,
  isCodeFileIndexed,
} from "@klm/codebase-indexer";

const DATABASE_URL = process.env.DATABASE_URL;
const PROJECT_ID = process.env.KLM_DEMO_PROJECT_ID ?? "00000000-0000-4000-8000-000000000003";

interface EvalResult {
  name: string;
  passed: boolean;
  message: string;
}

const results: EvalResult[] = [];

function record(name: string, passed: boolean, message: string): void {
  results.push({ name, passed, message });
}

function repoRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
}

async function clearCodebaseIndex(pool: pg.Pool, projectId: string): Promise<void> {
  await pool.query(`DELETE FROM code_routes WHERE project_id = $1`, [projectId]);
  await pool.query(`DELETE FROM code_symbols WHERE project_id = $1`, [projectId]);
  await pool.query(`DELETE FROM code_dependencies WHERE project_id = $1`, [projectId]);
  await pool.query(`DELETE FROM code_files WHERE project_id = $1`, [projectId]);
  await pool.query(
    `DELETE FROM memory_chunks
     WHERE project_id = $1 AND chunk_type IN ('code_file', 'code_symbol', 'code_route')`,
    [projectId]
  );
}

async function createSecurityFixture(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "klm-codebase-eval-"));
  await writeFile(join(dir, ".env"), "OPENAI_API_KEY=sk-eval-secret\n", "utf8");
  await writeFile(join(dir, ".npmrc"), "//registry.npmjs.org/:_authToken=eval-secret\n", "utf8");
  await writeFile(
    join(dir, "private.pem"),
    "-----BEGIN RSA PRIVATE KEY-----\nMIIBogIBAAJBAKfake\n",
    "utf8"
  );
  await writeFile(join(dir, "valid.ts"), "export function indexedOk() { return 1; }\n", "utf8");
  const largeBody = "export const big = '" + "x".repeat(DEFAULT_MAX_FILE_BYTES) + "';\n";
  await writeFile(join(dir, "large.ts"), largeBody, "utf8");
  return dir;
}

async function runSecurityFixtureEval(
  indexer: CodebaseIndexer,
  pool: pg.Pool,
  projectId: string,
  connectionString: string
): Promise<void> {
  const fixtureRoot = await createSecurityFixture();

  try {
    await clearCodebaseIndex(pool, projectId);

    const result = await indexer.indexProject({
      root: fixtureRoot,
      projectId,
      connectionString,
    });

    const envIndexed = await isCodeFileIndexed(pool, projectId, ".env");
    record("skips-env-file", !envIndexed, envIndexed ? ".env was indexed" : ".env not indexed");

    const npmrcIndexed = await isCodeFileIndexed(pool, projectId, ".npmrc");
    record(
      "skips-npmrc-file",
      !npmrcIndexed,
      npmrcIndexed ? ".npmrc was indexed" : ".npmrc not indexed"
    );

    const pemIndexed = await isCodeFileIndexed(pool, projectId, "private.pem");
    record(
      "skips-pem-file",
      !pemIndexed,
      pemIndexed ? "private.pem was indexed" : "private.pem not indexed"
    );

    const largeIndexed = await isCodeFileIndexed(pool, projectId, "large.ts");
    record(
      "skips-over-max-size-file",
      !largeIndexed,
      largeIndexed
        ? "large.ts exceeded max size but was indexed"
        : `large.ts skipped (max=${DEFAULT_MAX_FILE_BYTES} bytes)`
    );

    const validIndexed = await isCodeFileIndexed(pool, projectId, "valid.ts");
    record(
      "indexes-valid-source-file",
      validIndexed && result.filesIndexed === 1,
      `valid.ts indexed=${validIndexed}, filesIndexed=${result.filesIndexed}`
    );
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  if (!DATABASE_URL) {
    console.error("DATABASE_URL required for codebase indexer evals");
    process.exit(1);
  }

  const root = repoRoot();
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  const indexer = new CodebaseIndexer(DATABASE_URL);

  try {
    const hasCodeFiles = await tableExists(pool, "code_files");
    const hasCodeSymbols = await tableExists(pool, "code_symbols");
    const hasCodeDeps = await tableExists(pool, "code_dependencies");
    const hasCodeRoutes = await tableExists(pool, "code_routes");

    record(
      "codebase-schema-present",
      hasCodeFiles && hasCodeSymbols && hasCodeDeps && hasCodeRoutes,
      `code_files=${hasCodeFiles} code_symbols=${hasCodeSymbols} deps=${hasCodeDeps} routes=${hasCodeRoutes}`
    );

    await runSecurityFixtureEval(indexer, pool, PROJECT_ID, DATABASE_URL);

    await clearCodebaseIndex(pool, PROJECT_ID);

    const first = await indexer.indexProject({
      root,
      projectId: PROJECT_ID,
      connectionString: DATABASE_URL,
    });

    record("indexes-files", first.filesIndexed >= 20, `filesIndexed=${first.filesIndexed}`);

    const ignoredIndexed = await hasIgnoredPathIndexed(pool, PROJECT_ID);
    record(
      "ignores-node_modules-dist-git-klm-data",
      !ignoredIndexed,
      ignoredIndexed ? "found ignored paths in code_files" : "no ignored paths indexed"
    );

    const secretsIndexed = await hasSecretPathIndexed(pool, PROJECT_ID);
    record(
      "ignores-secret-paths-in-repo",
      !secretsIndexed,
      secretsIndexed ? "found secret paths in code_files" : "no secret paths indexed"
    );

    const depCount = await pool.query<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM code_dependencies WHERE project_id = $1`,
      [PROJECT_ID]
    );
    record(
      "detects-imports",
      (depCount.rows[0]?.c ?? 0) > 0,
      `dependencies=${depCount.rows[0]?.c ?? 0}`
    );

    const exportedSymbols = await pool.query<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM code_symbols WHERE project_id = $1 AND exported = true`,
      [PROJECT_ID]
    );
    record(
      "detects-exported-symbols",
      (exportedSymbols.rows[0]?.c ?? 0) > 0,
      `exportedSymbols=${exportedSymbols.rows[0]?.c ?? 0}`
    );

    const routeCount = await pool.query<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM code_routes WHERE project_id = $1`,
      [PROJECT_ID]
    );
    const healthRoute = await pool.query(
      `SELECT 1 FROM code_routes WHERE project_id = $1 AND path = '/health' LIMIT 1`,
      [PROJECT_ID]
    );
    record(
      "detects-fastify-routes",
      (routeCount.rows[0]?.c ?? 0) > 0 && (healthRoute.rowCount ?? 0) > 0,
      `routes=${routeCount.rows[0]?.c ?? 0} hasHealth=${(healthRoute.rowCount ?? 0) > 0}`
    );

    const semanticEnabled =
      process.env.KLM_SEMANTIC_MEMORY === "true" &&
      (process.env.KLM_EMBEDDING_PROVIDER === "mock" || Boolean(process.env.OPENAI_API_KEY));

    const codeChunks = await countSemanticCodeChunks(pool, PROJECT_ID);
    record(
      "writes-memory-chunks-code-types",
      semanticEnabled ? codeChunks > 0 : codeChunks === 0,
      semanticEnabled
        ? `codeChunks=${codeChunks} (semantic enabled)`
        : `codeChunks=${codeChunks} (semantic disabled — structured-only OK)`
    );

    const filesAfterFirst = await countIndexedFiles(pool, PROJECT_ID);
    const routesAfterFirst = routeCount.rows[0]?.c ?? 0;
    const chunksAfterFirst = codeChunks;

    const second = await indexer.indexProject({
      root,
      projectId: PROJECT_ID,
      connectionString: DATABASE_URL,
    });

    const filesAfterSecond = await countIndexedFiles(pool, PROJECT_ID);
    const routesAfterSecondRes = await pool.query<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM code_routes WHERE project_id = $1`,
      [PROJECT_ID]
    );
    const routesAfterSecond = routesAfterSecondRes.rows[0]?.c ?? 0;
    const chunksAfterSecond = await countSemanticCodeChunks(pool, PROJECT_ID);

    record(
      "second-run-idempotent",
      filesAfterFirst === filesAfterSecond &&
        routesAfterFirst === routesAfterSecond &&
        chunksAfterFirst === chunksAfterSecond &&
        second.filesIndexed === first.filesIndexed,
      `files ${filesAfterFirst}->${filesAfterSecond}, routes ${routesAfterFirst}->${routesAfterSecond}, chunks ${chunksAfterFirst}->${chunksAfterSecond}`
    );
  } finally {
    await indexer.close();
    await pool.end();
  }

  console.log("\nKLM Codebase Indexer Evaluation\n" + "=".repeat(40));
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
