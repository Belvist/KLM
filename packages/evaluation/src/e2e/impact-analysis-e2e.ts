import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { buildGateway } from "@klm/api/gateway";
import { createKlmApp, resetKlmAppForTests } from "@klm/bootstrap";
import { CodebaseIndexer, CodebaseQueryReader } from "@klm/codebase-indexer";
import {
  handleImpactAnalyze,
  ImpactAnalyzer,
  responseExcludesSensitiveContent,
} from "@klm/impact-analyzer";
import { PostgreSQLStateStore } from "@klm/state-store";
import type { EvalResult } from "./helpers.js";
import { DEMO_IDS, LIVE_IDS, record, tenantHeaders } from "./helpers.js";

const SECRET_FIXTURE_PATHS = [".env", ".npmrc", "private.pem", "id_rsa", "dist/leak.ts"] as const;
const CONTENT_LEAK_MARKER = "KLM_IMPACT_E2E_SECRET_BODY_MARKER_XYZ789";
const TASK_SECRET_MARKER = "sk-impact-secret-123";

function repoRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
}

async function insertSecretFixtures(pool: pg.Pool, projectId: string): Promise<void> {
  for (const relativePath of SECRET_FIXTURE_PATHS) {
    const fileRes = await pool.query<{ id: string }>(
      `INSERT INTO code_files (project_id, relative_path, content_hash, language, line_count)
       VALUES ($1, $2, $3, 'unknown', 1)
       ON CONFLICT (project_id, relative_path)
       DO UPDATE SET content_hash = EXCLUDED.content_hash
       RETURNING id`,
      [projectId, relativePath, `${CONTENT_LEAK_MARKER}-${relativePath}`]
    );
    const fileId = fileRes.rows[0]?.id;
    if (!fileId) continue;

    await pool.query(
      `INSERT INTO code_symbols (project_id, file_id, symbol_type, name, exported, line_start)
       VALUES ($1, $2, 'function', $3, true, 1)
       ON CONFLICT DO NOTHING`,
      [projectId, fileId, `leak_${relativePath.replace(/\W/g, "_")}`]
    );
  }
}

async function seedImpactFixtures(pool: pg.Pool, projectId: string): Promise<void> {
  const queuePath = "frontend/src/components/QueuePanel.tsx";
  const fileRes = await pool.query<{ id: string }>(
    `INSERT INTO code_files (project_id, relative_path, content_hash, language, line_count)
     VALUES ($1, $2, $3, 'typescript', 120)
     ON CONFLICT (project_id, relative_path)
     DO UPDATE SET content_hash = EXCLUDED.content_hash
     RETURNING id`,
    [projectId, queuePath, "fixture-queue-panel"]
  );
  const fileId = fileRes.rows[0]?.id;
  if (!fileId) return;

  await pool.query(
    `INSERT INTO code_symbols (project_id, file_id, symbol_type, name, exported, line_start)
     VALUES ($1, $2, 'function', 'QueuePanel', true, 10),
            ($1, $2, 'class', 'GestureArbiter', true, 40)
     ON CONFLICT DO NOTHING`,
    [projectId, fileId]
  );

  const store = new PostgreSQLStateStore(process.env.DATABASE_URL!);
  try {
    let state = await store.getProjectState(projectId);
    if (!state) return;

    const invRules = [
      "INV-FE-003: Queue panel state flows through DeviceSyncContext",
      "INV-FE-004: Queue panel uses GestureArbiter for drag",
      "INV-FE-005: Real-touch e2e required for gesture changes",
    ];

    for (const rule of invRules) {
      const invCode = rule.split(":")[0]!.trim();
      const hasTaskRelevant = state.invariants.some(
        (i) => i.rule.includes(invCode) && /queue|panel|gesture|drag/i.test(i.rule)
      );
      if (hasTaskRelevant) continue;
      await store.applyMemoryUpdate(projectId, {
        newInvariants: [
          {
            id: randomUUID(),
            projectId,
            rule,
            reason: "impact e2e fixture",
            severity: "hard",
            appliesTo: ["frontend"],
          },
        ],
      });
      state = (await store.getProjectState(projectId))!;
    }

    const decisionText = "2026-05-30 — Queue panel handle gestures + pointer machine hardening";
    if (!state.decisions.some((d) => d.decision.includes("Queue panel handle gestures"))) {
      await store.applyMemoryUpdate(projectId, {
        newDecisions: [
          {
            id: randomUUID(),
            projectId,
            decision: decisionText,
            reason: ["gesture reliability"],
            rejectedAlternatives: [],
            consequencesExpected: [],
            consequencesObserved: [],
            linkedFiles: [queuePath],
            linkedModules: ["frontend"],
            linkedRisks: [],
            status: "active",
            createdAt: new Date(),
          },
        ],
      });
    }
  } finally {
    await store.close();
  }
}

function collectPaths(report: Record<string, unknown>): string[] {
  const paths: string[] = [];
  for (const f of (report.affectedFiles as Array<{ path: string }>) ?? []) paths.push(f.path);
  for (const r of (report.affectedRoutes as Array<{ filePath: string }>) ?? [])
    paths.push(r.filePath);
  for (const s of (report.affectedSymbols as Array<{ filePath: string }>) ?? [])
    paths.push(s.filePath);
  return paths;
}

export async function runImpactAnalysisE2e(pool: pg.Pool, results: EvalResult[]): Promise<void> {
  resetKlmAppForTests();

  const projectId = DEMO_IDS.project;
  const connectionString = process.env.DATABASE_URL!;
  const root = repoRoot();

  await pool.query(`DELETE FROM code_routes WHERE project_id = $1`, [projectId]);
  await pool.query(`DELETE FROM code_symbols WHERE project_id = $1`, [projectId]);
  await pool.query(`DELETE FROM code_dependencies WHERE project_id = $1`, [projectId]);
  await pool.query(`DELETE FROM code_files WHERE project_id = $1`, [projectId]);

  const indexer = new CodebaseIndexer(connectionString);
  try {
    await indexer.indexProject({ root, projectId, connectionString });
  } finally {
    await indexer.close();
  }

  await seedImpactFixtures(pool, projectId);
  await insertSecretFixtures(pool, projectId);

  const countsBefore = await pool.query<{
    events: string;
    invariants: string;
    decisions: string;
  }>(
    `SELECT
       (SELECT COUNT(*)::text FROM events WHERE project_id = $1) AS events,
       (SELECT jsonb_array_length(state->'invariants')::text FROM project_states WHERE id = $1) AS invariants,
       (SELECT jsonb_array_length(state->'decisions')::text FROM project_states WHERE id = $1) AS decisions`,
    [projectId]
  );
  const before = countsBefore.rows[0]!;

  const klmApp = await createKlmApp({ reset: true });
  const { app } = await buildGateway({ klmApp, logger: false });

  const analyzeRes = await app.inject({
    method: "POST",
    url: `/v1/projects/${projectId}/impact/analyze`,
    headers: tenantHeaders(),
    payload: { task: "queue panel drag gesture hardening" },
  });

  record(
    results,
    "impact-e2e-analyze-status",
    analyzeRes.statusCode === 200,
    `status=${analyzeRes.statusCode}`
  );

  const report = analyzeRes.json() as Record<string, unknown>;
  const reportJson = analyzeRes.body;

  const countsAfter = await pool.query<{
    events: string;
    invariants: string;
    decisions: string;
  }>(
    `SELECT
       (SELECT COUNT(*)::text FROM events WHERE project_id = $1) AS events,
       (SELECT jsonb_array_length(state->'invariants')::text FROM project_states WHERE id = $1) AS invariants,
       (SELECT jsonb_array_length(state->'decisions')::text FROM project_states WHERE id = $1) AS decisions`,
    [projectId]
  );
  const after = countsAfter.rows[0]!;

  record(
    results,
    "impact-e2e-no-memory-writes",
    before.events === after.events &&
      before.invariants === after.invariants &&
      before.decisions === after.decisions,
    `events ${before.events}→${after.events} inv ${before.invariants}→${after.invariants} dec ${before.decisions}→${after.decisions}`
  );

  const hasQueueFile = ((report.affectedFiles as Array<{ path: string }>) ?? []).some((f) =>
    f.path.toLowerCase().includes("queue")
  );
  const hasInvFe003 = ((report.relatedInvariants as Array<{ rule: string }>) ?? []).some((i) =>
    i.rule.includes("INV-FE-003")
  );
  const hasFakeInv = ((report.relatedInvariants as Array<{ rule: string }>) ?? []).some((i) =>
    i.rule.includes("INV-FAKE-NOT-IN-DB")
  );

  record(
    results,
    "impact-e2e-queue-relevant-hits",
    hasQueueFile || hasInvFe003,
    `file=${hasQueueFile} inv-fe-003=${hasInvFe003}`
  );

  record(
    results,
    "impact-e2e-invariants-from-project-state-only",
    hasInvFe003 && !hasFakeInv,
    `real inv present, fake absent`
  );

  record(
    results,
    "impact-e2e-metadata-only-flag",
    report.metadataOnly === true,
    `metadataOnly=${report.metadataOnly}`
  );

  record(
    results,
    "impact-e2e-no-file-content",
    responseExcludesSensitiveContent(reportJson, [CONTENT_LEAK_MARKER]),
    "no content keys or secret body marker"
  );

  const secretTaskRes = await app.inject({
    method: "POST",
    url: `/v1/projects/${projectId}/impact/analyze`,
    headers: tenantHeaders(),
    payload: { task: `queue panel drag ${TASK_SECRET_MARKER}` },
  });
  const secretTaskJson = secretTaskRes.body;
  const secretTaskReport = secretTaskRes.json() as {
    task?: string;
    taskPreview?: string;
    taskHash?: string;
  };
  record(
    results,
    "impact-e2e-task-secret-not-echoed",
    secretTaskRes.statusCode === 200 &&
      !secretTaskJson.includes(TASK_SECRET_MARKER) &&
      !("task" in secretTaskReport) &&
      typeof secretTaskReport.taskHash === "string" &&
      secretTaskReport.taskHash.length === 64 &&
      typeof secretTaskReport.taskPreview === "string" &&
      !secretTaskReport.taskPreview.includes(TASK_SECRET_MARKER),
    `raw task absent, hash=${secretTaskReport.taskHash?.slice(0, 8)}…`
  );

  const paths = collectPaths(report);
  const secretLeaks = SECRET_FIXTURE_PATHS.filter((p) => paths.some((path) => path.includes(p)));
  record(
    results,
    "impact-e2e-secret-paths-filtered",
    secretLeaks.length === 0,
    secretLeaks.length ? `leaked=${secretLeaks.join(",")}` : "no secret paths"
  );

  record(
    results,
    "impact-e2e-confidence-hit-task",
    report.confidence === "medium" || report.confidence === "high",
    `confidence=${report.confidence ?? "missing"}`
  );

  const cross = await app.inject({
    method: "POST",
    url: `/v1/projects/${LIVE_IDS.project}/impact/analyze`,
    headers: tenantHeaders(),
    payload: { task: "queue panel" },
  });
  record(
    results,
    "impact-e2e-tenant-boundary-403",
    cross.statusCode === 403,
    `cross-project status=${cross.statusCode}`
  );

  const capped = await app.inject({
    method: "POST",
    url: `/v1/projects/${projectId}/impact/analyze`,
    headers: tenantHeaders(),
    payload: { task: "health user route symbol file", limit: 5000 },
  });
  const cappedReport = capped.json() as Record<string, unknown>;
  const perSectionOk =
    ((cappedReport.affectedFiles as unknown[])?.length ?? 0) <= 100 &&
    ((cappedReport.affectedRoutes as unknown[])?.length ?? 0) <= 100 &&
    ((cappedReport.affectedSymbols as unknown[])?.length ?? 0) <= 100;
  record(
    results,
    "impact-e2e-limit-cap-5000",
    perSectionOk,
    `files=${(cappedReport.affectedFiles as unknown[])?.length ?? 0} routes=${(cappedReport.affectedRoutes as unknown[])?.length ?? 0}`
  );

  const empty = await app.inject({
    method: "POST",
    url: `/v1/projects/${projectId}/impact/analyze`,
    headers: tenantHeaders(),
    payload: { task: "" },
  });
  const emptyReport = empty.json() as { confidence?: string };
  record(
    results,
    "impact-e2e-empty-task-low-confidence",
    empty.statusCode === 200 && emptyReport.confidence === "low",
    `status=${empty.statusCode} confidence=${emptyReport.confidence}`
  );

  const nonsense = await app.inject({
    method: "POST",
    url: `/v1/projects/${projectId}/impact/analyze`,
    headers: tenantHeaders(),
    payload: { task: "xyzzy qwerty zzzzzz nonsense nomatch12345" },
  });
  const nonsenseReport = nonsense.json() as {
    confidence?: string;
    affectedFiles?: unknown[];
    relatedInvariants?: unknown[];
  };
  record(
    results,
    "impact-e2e-nonsense-low-confidence",
    nonsense.statusCode === 200 &&
      nonsenseReport.confidence === "low" &&
      (nonsenseReport.affectedFiles?.length ?? 0) === 0 &&
      (nonsenseReport.relatedInvariants?.length ?? 0) === 0,
    `confidence=${nonsenseReport.confidence}`
  );

  record(
    results,
    "impact-e2e-confidence-not-always-high",
    (report.confidence === "medium" || report.confidence === "high") &&
      nonsenseReport.confidence === "low",
    `hit=${report.confidence} miss=${nonsenseReport.confidence}`
  );

  await app.close();

  const reader = new CodebaseQueryReader(connectionString);
  const store = new PostgreSQLStateStore(connectionString);
  const analyzer = new ImpactAnalyzer(reader, {
    getInvariants: (pid) => store.getInvariants(pid),
    getDecisions: (pid) => store.getDecisions(pid),
    getRisks: async (pid) => (await store.getProjectState(pid))?.risks ?? [],
  });

  try {
    const allowed = await handleImpactAnalyze(analyzer, projectId, {
      task: "queue panel drag",
    });
    const blocked = await handleImpactAnalyze(analyzer, projectId, {
      task: "queue",
      projectId: LIVE_IDS.project,
    });

    record(
      results,
      "impact-e2e-mcp-handler-tenant",
      !("error" in allowed) && "error" in blocked && blocked.code === "FORBIDDEN",
      `allowed=${!("error" in allowed)} forbidden=${"error" in blocked}`
    );

    record(
      results,
      "impact-e2e-mcp-no-project-id-in-result",
      !("projectId" in (allowed as Record<string, unknown>)),
      "report has no projectId field"
    );
  } finally {
    await reader.close();
    await store.close();
  }
}
