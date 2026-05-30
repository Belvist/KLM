import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { buildGateway } from "@klm/api/gateway";
import {
  CodebaseIndexer,
  CodebaseQueryReader,
  handleCodebaseSearch,
  parseSearchKind,
} from "@klm/codebase-indexer";
import { createKlmApp, resetKlmAppForTests } from "@klm/bootstrap";
import type { EvalResult } from "./helpers.js";
import { DEMO_IDS, LIVE_IDS, record, tenantHeaders } from "./helpers.js";

interface PaginatedResponse<T> {
  items: T[];
  nextCursor?: string;
  limit?: number;
}

const CODEBASE_ENDPOINTS = ["files", "routes", "symbols", "dependencies"] as const;

function repoRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
}

function collectPaths(items: Array<{ relativePath?: string; filePath?: string }>): string[] {
  return items.map((i) => i.relativePath ?? i.filePath ?? "").filter(Boolean);
}

const SECRET_FIXTURE_PATHS = [".env", ".npmrc", "private.pem", "id_rsa"] as const;

async function insertDefensiveSecretFixtures(pool: pg.Pool, projectId: string): Promise<void> {
  for (const relativePath of SECRET_FIXTURE_PATHS) {
    const fileRes = await pool.query<{ id: string }>(
      `INSERT INTO code_files (project_id, relative_path, content_hash, language, line_count)
       VALUES ($1, $2, $3, 'unknown', 1)
       ON CONFLICT (project_id, relative_path)
       DO UPDATE SET content_hash = EXCLUDED.content_hash
       RETURNING id`,
      [projectId, relativePath, `fixture-${relativePath}`]
    );
    const fileId = fileRes.rows[0]?.id;
    if (!fileId) continue;

    await pool.query(
      `INSERT INTO code_routes (project_id, file_id, http_method, path, line_number)
       VALUES ($1, $2, 'GET', $3, 1)
       ON CONFLICT DO NOTHING`,
      [projectId, fileId, `/secret-${relativePath.replace(/\./g, "-")}`]
    );

    await pool.query(
      `INSERT INTO code_symbols (project_id, file_id, symbol_type, name, exported, line_start)
       VALUES ($1, $2, 'function', $3, true, 1)
       ON CONFLICT DO NOTHING`,
      [projectId, fileId, `leak_${relativePath.replace(/\W/g, "_")}`]
    );

    await pool.query(
      `INSERT INTO code_dependencies (project_id, source_file_id, target_module, import_kind)
       VALUES ($1, $2, $3, 'import')
       ON CONFLICT DO NOTHING`,
      [projectId, fileId, `./${relativePath}`]
    );
  }
}

function pathsIncludeSecretFixtures(paths: string[]): string[] {
  return SECRET_FIXTURE_PATHS.filter((secret) =>
    paths.some((p) => p === secret || p.includes(secret) || p.endsWith(`/${secret}`))
  );
}

export async function runCodebaseQueryE2e(pool: pg.Pool, results: EvalResult[]): Promise<void> {
  resetKlmAppForTests();

  const projectId = DEMO_IDS.project;
  const root = repoRoot();
  const connectionString = process.env.DATABASE_URL!;

  await pool.query(`DELETE FROM code_routes WHERE project_id = $1`, [projectId]);
  await pool.query(`DELETE FROM code_symbols WHERE project_id = $1`, [projectId]);
  await pool.query(`DELETE FROM code_dependencies WHERE project_id = $1`, [projectId]);
  await pool.query(`DELETE FROM code_files WHERE project_id = $1`, [projectId]);

  const indexer = new CodebaseIndexer(connectionString);
  try {
    const indexed = await indexer.indexProject({ root, projectId, connectionString });
    record(
      results,
      "codebase-query-index-setup",
      indexed.filesIndexed >= 20,
      `filesIndexed=${indexed.filesIndexed}`
    );
  } finally {
    await indexer.close();
  }

  await insertDefensiveSecretFixtures(pool, projectId);

  const klmApp = await createKlmApp({ reset: true });
  const { app } = await buildGateway({ klmApp, logger: false });

  const filesRes = await app.inject({
    method: "GET",
    url: `/v1/projects/${projectId}/codebase/files?limit=50`,
    headers: tenantHeaders(),
  });

  const filesBody = filesRes.json() as PaginatedResponse<{ relativePath: string }>;
  record(
    results,
    "codebase-query-files",
    filesRes.statusCode === 200 && (filesBody.items?.length ?? 0) > 0,
    `status=${filesRes.statusCode} items=${filesBody.items?.length ?? 0}`
  );

  const routesRes = await app.inject({
    method: "GET",
    url: `/v1/projects/${projectId}/codebase/routes?limit=50&path=/health`,
    headers: tenantHeaders(),
  });

  const routesBody = routesRes.json() as PaginatedResponse<{ path: string; filePath: string }>;
  const hasHealth = routesBody.items?.some((r) => r.path === "/health") ?? false;
  record(
    results,
    "codebase-query-routes",
    routesRes.statusCode === 200 && hasHealth,
    `status=${routesRes.statusCode} hasHealth=${hasHealth}`
  );

  const symbolsRes = await app.inject({
    method: "GET",
    url: `/v1/projects/${projectId}/codebase/symbols?limit=50&exported=true`,
    headers: tenantHeaders(),
  });

  const symbolsBody = symbolsRes.json() as PaginatedResponse<{
    name: string;
    exported: boolean;
    filePath: string;
  }>;
  const exportedCount = symbolsBody.items?.filter((s) => s.exported).length ?? 0;
  record(
    results,
    "codebase-query-symbols",
    symbolsRes.statusCode === 200 && exportedCount > 0,
    `status=${symbolsRes.statusCode} exported=${exportedCount}`
  );

  const depsRes = await app.inject({
    method: "GET",
    url: `/v1/projects/${projectId}/codebase/dependencies?limit=50`,
    headers: tenantHeaders(),
  });

  const depsBody = depsRes.json() as PaginatedResponse<{
    targetModule: string;
    sourceFilePath: string;
  }>;
  record(
    results,
    "codebase-query-dependencies",
    depsRes.statusCode === 200 && (depsBody.items?.length ?? 0) > 0,
    `status=${depsRes.statusCode} items=${depsBody.items?.length ?? 0}`
  );

  let all403 = true;
  const forbiddenStatuses: string[] = [];
  for (const endpoint of CODEBASE_ENDPOINTS) {
    const forbiddenRes = await app.inject({
      method: "GET",
      url: `/v1/projects/${LIVE_IDS.project}/codebase/${endpoint}?limit=10`,
      headers: tenantHeaders(),
    });
    forbiddenStatuses.push(`${endpoint}=${forbiddenRes.statusCode}`);
    if (forbiddenRes.statusCode !== 403) all403 = false;
  }

  record(results, "codebase-query-tenant-403-all-endpoints", all403, forbiddenStatuses.join(", "));

  let allLimitCapped = true;
  const limitStatuses: string[] = [];
  for (const endpoint of CODEBASE_ENDPOINTS) {
    const limitRes = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/codebase/${endpoint}?limit=500`,
      headers: tenantHeaders(),
    });
    const limitBody = limitRes.json() as PaginatedResponse<unknown> & { limit?: number };
    const ok =
      limitRes.statusCode === 200 &&
      limitBody.limit === 100 &&
      (limitBody.items?.length ?? 0) <= 100;
    limitStatuses.push(`${endpoint}=${limitBody.limit}/${limitBody.items?.length ?? 0}`);
    if (!ok) allLimitCapped = false;
  }

  record(
    results,
    "codebase-query-limit-cap-all-endpoints",
    allLimitCapped,
    limitStatuses.join(", ")
  );

  const reader = new CodebaseQueryReader(connectionString);
  try {
    const defensiveFiles = await reader.listFiles({ projectId, limit: 100, q: "env" });
    const defensiveRoutes = await reader.listRoutes({ projectId, limit: 100, path: "secret" });
    const defensiveSymbols = await reader.listSymbols({ projectId, limit: 100, name: "leak" });
    const defensiveDeps = await reader.listDependencies({ projectId, limit: 100, q: ".env" });

    const leakedPaths = [
      ...collectPaths(defensiveFiles.items),
      ...collectPaths(defensiveRoutes.items),
      ...collectPaths(defensiveSymbols.items),
      ...collectPaths(defensiveDeps.items.map((d) => ({ filePath: d.sourceFilePath }))),
    ];

    const leakedSecrets = pathsIncludeSecretFixtures(leakedPaths);
    record(
      results,
      "codebase-query-defensive-secret-rows-hidden",
      leakedSecrets.length === 0,
      leakedSecrets.length > 0
        ? `leaked fixtures: ${leakedSecrets.join(", ")}`
        : `checked reader lists; fixture paths not returned (${SECRET_FIXTURE_PATHS.join(", ")})`
    );

    const searchResult = await reader.search({ projectId, query: ".env", kind: "all", limit: 50 });
    const searchPaths = [
      ...collectPaths(searchResult.files),
      ...collectPaths(searchResult.routes),
      ...collectPaths(searchResult.symbols),
      ...collectPaths(searchResult.dependencies.map((d) => ({ filePath: d.sourceFilePath }))),
    ];
    const searchLeaks = pathsIncludeSecretFixtures(searchPaths);
    record(
      results,
      "codebase-query-search-metadata-only-no-secrets",
      searchLeaks.length === 0,
      searchLeaks.length > 0
        ? `search leaked: ${searchLeaks.join(", ")}`
        : "search over structured metadata did not return secret fixture paths"
    );
  } finally {
    await reader.close();
  }

  let kindRejected = false;
  try {
    parseSearchKind("memory_chunks");
  } catch {
    kindRejected = true;
  }
  record(results, "codebase-query-kind-allowlist", kindRejected, "invalid kind rejected");

  const mcpReader = new CodebaseQueryReader(connectionString);
  try {
    const allowed = await handleCodebaseSearch(mcpReader, DEMO_IDS.project, {
      query: "gateway",
      kind: "files",
      limit: 5,
    });
    const allowedOk = "query" in allowed && allowed.files.length >= 0;

    const forbidden = await handleCodebaseSearch(mcpReader, DEMO_IDS.project, {
      query: "gateway",
      projectId: LIVE_IDS.project,
    });
    const forbiddenOk =
      "code" in forbidden && forbidden.code === "FORBIDDEN" && !("files" in forbidden);

    record(
      results,
      "codebase-query-mcp-uses-tenant-project",
      allowedOk && forbiddenOk,
      `allowed=${allowedOk} crossProjectBlocked=${forbiddenOk}`
    );
  } finally {
    await mcpReader.close();
  }

  await app.close();
}
