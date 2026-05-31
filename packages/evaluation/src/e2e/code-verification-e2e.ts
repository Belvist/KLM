import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { buildGateway } from "@klm/api/gateway";
import { createKlmApp, resetKlmAppForTests } from "@klm/bootstrap";
import { CodebaseIndexer, CodebaseQueryReader } from "@klm/codebase-indexer";
import {
  CodeVerifier,
  handleCodeVerify,
  responseExcludesSensitiveCodeContent,
} from "@klm/code-verifier";
import { ImpactAnalyzer } from "@klm/impact-analyzer";
import { PostgreSQLStateStore } from "@klm/state-store";
import type { EvalResult } from "./helpers.js";
import { DEMO_IDS, LIVE_IDS, record, tenantHeaders } from "./helpers.js";

const CODE_SECRET_MARKER = "sk-code-secret-789";

function repoRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
}

async function seedCodeFixtures(pool: pg.Pool, projectId: string): Promise<void> {
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
            reason: "code verify e2e fixture",
            severity: "hard",
            appliesTo: ["frontend"],
          },
        ],
      });
      state = (await store.getProjectState(projectId))!;
    }
  } finally {
    await store.close();
  }
}

export async function runCodeVerificationE2e(pool: pg.Pool, results: EvalResult[]): Promise<void> {
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

  await seedCodeFixtures(pool, projectId);

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

  const legacyRes = await app.inject({
    method: "POST",
    url: `/v1/projects/${projectId}/code/verify`,
    headers: tenantHeaders(),
    payload: { content: "legacy endpoint without auth" },
  });
  record(
    results,
    "code-e2e-legacy-content-api-rejected",
    legacyRes.statusCode === 400,
    `legacy content status=${legacyRes.statusCode} (expected 400)`
  );

  const goodImpl = {
    summary: "Hardened QueuePanel drag via GestureArbiter; DeviceSyncContext unchanged",
    files: ["frontend/src/components/QueuePanel.tsx"],
    tests: ["Real-touch e2e for queue panel drag gesture"],
  };

  const passRes = await app.inject({
    method: "POST",
    url: `/v1/projects/${projectId}/code/verify`,
    headers: tenantHeaders(),
    payload: { task: "queue panel drag gesture hardening", implementation: goodImpl },
  });

  record(
    results,
    "code-e2e-verify-status",
    passRes.statusCode === 200,
    `status=${passRes.statusCode}`
  );

  const passReport = passRes.json() as { verdict?: string };
  record(
    results,
    "code-e2e-pass-verdict",
    passReport.verdict === "pass",
    `verdict=${passReport.verdict ?? "missing"} (expected pass)`
  );

  const countsAfterPass = await pool.query<{
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
  const afterPass = countsAfterPass.rows[0]!;

  record(
    results,
    "code-e2e-no-memory-writes",
    before.events === afterPass.events &&
      before.invariants === afterPass.invariants &&
      before.decisions === afterPass.decisions,
    `events ${before.events}→${afterPass.events}`
  );

  const badImpl = {
    summary: "Removed GestureArbiter and bypassed drag arbitration for speed",
    files: ["frontend/src/components/QueuePanel.tsx"],
  };

  const blockedRes = await app.inject({
    method: "POST",
    url: `/v1/projects/${projectId}/code/verify`,
    headers: tenantHeaders(),
    payload: { task: "queue panel drag gesture", implementation: badImpl },
  });
  const blockedReport = blockedRes.json() as { verdict?: string; violations?: unknown[] };

  record(
    results,
    "code-e2e-invariant-violation-blocked",
    blockedRes.statusCode === 200 &&
      blockedReport.verdict === "blocked" &&
      (blockedReport.violations?.length ?? 0) > 0,
    `verdict=${blockedReport.verdict} violations=${blockedReport.violations?.length ?? 0}`
  );

  const noE2eImpl = {
    summary: "Refactored QueuePanel drag gesture handler implementation",
    files: ["frontend/src/components/QueuePanel.tsx"],
  };

  const missingE2eRes = await app.inject({
    method: "POST",
    url: `/v1/projects/${projectId}/code/verify`,
    headers: tenantHeaders(),
    payload: { task: "queue panel drag gesture", implementation: noE2eImpl },
  });
  const missingE2eReport = missingE2eRes.json() as {
    verdict?: string;
    missingTests?: string[];
  };

  record(
    results,
    "code-e2e-missing-e2e-needs-changes",
    missingE2eRes.statusCode === 200 &&
      missingE2eReport.verdict !== "pass" &&
      missingE2eReport.verdict === "needs_changes" &&
      (missingE2eReport.missingTests?.length ?? 0) > 0,
    `verdict=${missingE2eReport.verdict} missing=${missingE2eReport.missingTests?.length ?? 0}`
  );

  const authNoTestsImpl = {
    summary: "Added session auth middleware to /api/user routes without tests",
    files: ["apps/api/src/routes/user.ts"],
  };

  const authNoTestsRes = await app.inject({
    method: "POST",
    url: `/v1/projects/${projectId}/code/verify`,
    headers: tenantHeaders(),
    payload: { task: "add auth to user API endpoint", implementation: authNoTestsImpl },
  });
  const authNoTestsReport = authNoTestsRes.json() as {
    verdict?: string;
    missingTests?: string[];
  };

  record(
    results,
    "code-e2e-auth-missing-tests-not-pass",
    authNoTestsRes.statusCode === 200 &&
      authNoTestsReport.verdict !== "pass" &&
      (authNoTestsReport.missingTests?.length ?? 0) > 0,
    `verdict=${authNoTestsReport.verdict} missing=${authNoTestsReport.missingTests?.length ?? 0}`
  );

  const secretRes = await app.inject({
    method: "POST",
    url: `/v1/projects/${projectId}/code/verify`,
    headers: tenantHeaders(),
    payload: {
      task: `queue panel ${CODE_SECRET_MARKER}`,
      implementation: {
        summary: `Deploy with token ${CODE_SECRET_MARKER}`,
        files: ["frontend/src/components/QueuePanel.tsx"],
        tests: ["e2e smoke"],
      },
    },
  });
  const secretJson = secretRes.body;
  const secretReport = secretRes.json() as {
    summary?: unknown;
    contentPreview?: string;
    contentHash?: string;
    taskPreview?: string;
  };

  record(
    results,
    "code-e2e-secret-not-echoed",
    secretRes.statusCode === 200 &&
      !secretJson.includes(CODE_SECRET_MARKER) &&
      !("summary" in secretReport) &&
      typeof secretReport.contentHash === "string" &&
      secretReport.contentHash.length === 64 &&
      !secretReport.contentPreview?.includes(CODE_SECRET_MARKER) &&
      !secretReport.taskPreview?.includes(CODE_SECRET_MARKER),
    `hash=${secretReport.contentHash?.slice(0, 8)}… preview clean`
  );

  record(
    results,
    "code-e2e-no-raw-summary-field",
    responseExcludesSensitiveCodeContent(secretJson, [CODE_SECRET_MARKER]),
    "no summary key in response"
  );

  const cross = await app.inject({
    method: "POST",
    url: `/v1/projects/${LIVE_IDS.project}/code/verify`,
    headers: tenantHeaders(),
    payload: { task: "queue panel", implementation: goodImpl },
  });
  record(
    results,
    "code-e2e-tenant-boundary-403",
    cross.statusCode === 403,
    `cross-project status=${cross.statusCode}`
  );

  const planBlockedRes = await app.inject({
    method: "POST",
    url: `/v1/projects/${projectId}/code/verify`,
    headers: tenantHeaders(),
    payload: {
      task: "queue panel drag",
      implementation: goodImpl,
      planReport: {
        taskPreview: "t",
        taskHash: "h",
        planPreview: "p",
        planHash: "ph",
        verdict: "blocked",
        violations: [],
        missingTests: [],
        riskNotes: [],
        requiredChanges: [],
        confidence: "high",
        impactConfidence: "high",
        metadataOnly: true,
      },
    },
  });
  const planBlockedReport = planBlockedRes.json() as { verdict?: string; planVerdict?: string };

  record(
    results,
    "code-e2e-plan-blocked-cascade",
    planBlockedRes.statusCode === 200 &&
      planBlockedReport.verdict === "blocked" &&
      planBlockedReport.planVerdict === "blocked",
    `verdict=${planBlockedReport.verdict} planVerdict=${planBlockedReport.planVerdict}`
  );

  await app.close();

  const reader = new CodebaseQueryReader(connectionString);
  const store = new PostgreSQLStateStore(connectionString);
  const impactAnalyzer = new ImpactAnalyzer(reader, {
    getInvariants: (pid) => store.getInvariants(pid),
    getDecisions: (pid) => store.getDecisions(pid),
    getRisks: async (pid) => (await store.getProjectState(pid))?.risks ?? [],
  });
  const verifier = new CodeVerifier(impactAnalyzer);

  try {
    const allowed = await handleCodeVerify(verifier, projectId, {
      task: "queue panel drag",
      implementation: goodImpl,
    });
    const blocked = await handleCodeVerify(verifier, projectId, {
      task: "queue",
      implementation: goodImpl,
      projectId: LIVE_IDS.project,
    });

    record(
      results,
      "code-e2e-mcp-handler-tenant",
      !("error" in allowed) && "error" in blocked && blocked.code === "FORBIDDEN",
      `allowed=${!("error" in allowed)} forbidden=${"error" in blocked}`
    );

    record(
      results,
      "code-e2e-mcp-no-project-id-in-result",
      !("projectId" in (allowed as Record<string, unknown>)),
      "report has no projectId field"
    );
  } finally {
    await reader.close();
    await store.close();
  }
}
