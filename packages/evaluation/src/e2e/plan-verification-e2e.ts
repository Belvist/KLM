import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { buildGateway } from "@klm/api/gateway";
import { createKlmApp, resetKlmAppForTests } from "@klm/bootstrap";
import { CodebaseIndexer, CodebaseQueryReader } from "@klm/codebase-indexer";
import {
  PlanVerifier,
  handlePlanVerify,
  responseExcludesSensitivePlanContent,
} from "@klm/plan-verifier";
import { ImpactAnalyzer } from "@klm/impact-analyzer";
import { PostgreSQLStateStore } from "@klm/state-store";
import type { EvalResult } from "./helpers.js";
import { DEMO_IDS, LIVE_IDS, record, tenantHeaders } from "./helpers.js";

const PLAN_SECRET_MARKER = "sk-plan-secret-456";

function repoRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
}

async function seedPlanFixtures(pool: pg.Pool, projectId: string): Promise<void> {
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
            reason: "plan verify e2e fixture",
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

export async function runPlanVerificationE2e(pool: pg.Pool, results: EvalResult[]): Promise<void> {
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

  await seedPlanFixtures(pool, projectId);

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

  const safePlan = {
    steps: [
      "Harden QueuePanel drag via GestureArbiter",
      "Keep DeviceSyncContext as playback owner",
    ],
    files: ["frontend/src/components/QueuePanel.tsx"],
    tests: ["Real-touch e2e for queue panel drag gesture"],
  };

  const safeRes = await app.inject({
    method: "POST",
    url: `/v1/projects/${projectId}/plans/verify`,
    headers: tenantHeaders(),
    payload: { task: "queue panel drag gesture hardening", plan: safePlan },
  });

  record(
    results,
    "plan-e2e-verify-status",
    safeRes.statusCode === 200,
    `status=${safeRes.statusCode}`
  );

  const safeReport = safeRes.json() as { verdict?: string; confidence?: string };
  record(
    results,
    "plan-e2e-safe-plan-verdict",
    safeReport.verdict === "safe",
    `verdict=${safeReport.verdict ?? "missing"} (expected safe)`
  );

  const countsAfterSafe = await pool.query<{
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
  const afterSafe = countsAfterSafe.rows[0]!;

  record(
    results,
    "plan-e2e-no-memory-writes",
    before.events === afterSafe.events &&
      before.invariants === afterSafe.invariants &&
      before.decisions === afterSafe.decisions,
    `events ${before.events}→${afterSafe.events}`
  );

  const badPlan = {
    steps: ["Remove GestureArbiter and bypass drag arbitration for speed"],
    files: ["frontend/src/components/QueuePanel.tsx"],
  };

  const blockedRes = await app.inject({
    method: "POST",
    url: `/v1/projects/${projectId}/plans/verify`,
    headers: tenantHeaders(),
    payload: { task: "queue panel drag gesture", plan: badPlan },
  });
  const blockedReport = blockedRes.json() as { verdict?: string; violations?: unknown[] };

  record(
    results,
    "plan-e2e-invariant-violation-blocked",
    blockedRes.statusCode === 200 &&
      blockedReport.verdict === "blocked" &&
      (blockedReport.violations?.length ?? 0) > 0,
    `verdict=${blockedReport.verdict} violations=${blockedReport.violations?.length ?? 0}`
  );

  const noE2ePlan = {
    steps: ["Refactor QueuePanel drag gesture handler"],
    files: ["frontend/src/components/QueuePanel.tsx"],
  };

  const missingE2eRes = await app.inject({
    method: "POST",
    url: `/v1/projects/${projectId}/plans/verify`,
    headers: tenantHeaders(),
    payload: { task: "queue panel drag gesture", plan: noE2ePlan },
  });
  const missingE2eReport = missingE2eRes.json() as {
    verdict?: string;
    missingTests?: string[];
  };

  record(
    results,
    "plan-e2e-missing-e2e-needs-changes",
    missingE2eRes.statusCode === 200 &&
      missingE2eReport.verdict !== "safe" &&
      missingE2eReport.verdict === "needs_changes" &&
      (missingE2eReport.missingTests?.length ?? 0) > 0,
    `verdict=${missingE2eReport.verdict} missing=${missingE2eReport.missingTests?.length ?? 0}`
  );

  const authNoTestsPlan = {
    steps: ["Add session auth middleware to /api/user routes"],
    files: ["apps/api/src/routes/user.ts"],
  };

  const authNoTestsRes = await app.inject({
    method: "POST",
    url: `/v1/projects/${projectId}/plans/verify`,
    headers: tenantHeaders(),
    payload: { task: "add auth to user API endpoint", plan: authNoTestsPlan },
  });
  const authNoTestsReport = authNoTestsRes.json() as {
    verdict?: string;
    missingTests?: string[];
  };

  record(
    results,
    "plan-e2e-auth-missing-tests-not-safe",
    authNoTestsRes.statusCode === 200 &&
      authNoTestsReport.verdict !== "safe" &&
      (authNoTestsReport.missingTests?.length ?? 0) > 0,
    `verdict=${authNoTestsReport.verdict} missing=${authNoTestsReport.missingTests?.length ?? 0}`
  );

  const secretRes = await app.inject({
    method: "POST",
    url: `/v1/projects/${projectId}/plans/verify`,
    headers: tenantHeaders(),
    payload: {
      task: `queue panel ${PLAN_SECRET_MARKER}`,
      plan: {
        steps: [`Deploy with token ${PLAN_SECRET_MARKER}`],
        files: ["frontend/src/components/QueuePanel.tsx"],
        tests: ["e2e smoke"],
      },
    },
  });
  const secretJson = secretRes.body;
  const secretReport = secretRes.json() as {
    steps?: unknown;
    planPreview?: string;
    taskPreview?: string;
    planHash?: string;
  };

  record(
    results,
    "plan-e2e-plan-secret-not-echoed",
    secretRes.statusCode === 200 &&
      !secretJson.includes(PLAN_SECRET_MARKER) &&
      !("steps" in secretReport) &&
      typeof secretReport.planHash === "string" &&
      secretReport.planHash.length === 64 &&
      !secretReport.planPreview?.includes(PLAN_SECRET_MARKER) &&
      !secretReport.taskPreview?.includes(PLAN_SECRET_MARKER),
    `hash=${secretReport.planHash?.slice(0, 8)}… preview clean`
  );

  record(
    results,
    "plan-e2e-no-raw-steps-field",
    responseExcludesSensitivePlanContent(secretJson, [PLAN_SECRET_MARKER]),
    "no steps key in response"
  );

  const cross = await app.inject({
    method: "POST",
    url: `/v1/projects/${LIVE_IDS.project}/plans/verify`,
    headers: tenantHeaders(),
    payload: { task: "queue panel", plan: safePlan },
  });
  record(
    results,
    "plan-e2e-tenant-boundary-403",
    cross.statusCode === 403,
    `cross-project status=${cross.statusCode}`
  );

  await app.close();

  const reader = new CodebaseQueryReader(connectionString);
  const store = new PostgreSQLStateStore(connectionString);
  const impactAnalyzer = new ImpactAnalyzer(reader, {
    getInvariants: (pid) => store.getInvariants(pid),
    getDecisions: (pid) => store.getDecisions(pid),
    getRisks: async (pid) => (await store.getProjectState(pid))?.risks ?? [],
  });
  const verifier = new PlanVerifier(impactAnalyzer);

  try {
    const allowed = await handlePlanVerify(verifier, projectId, {
      task: "queue panel drag",
      plan: safePlan,
    });
    const blocked = await handlePlanVerify(verifier, projectId, {
      task: "queue",
      plan: safePlan,
      projectId: LIVE_IDS.project,
    });

    record(
      results,
      "plan-e2e-mcp-handler-tenant",
      !("error" in allowed) && "error" in blocked && blocked.code === "FORBIDDEN",
      `allowed=${!("error" in allowed)} forbidden=${"error" in blocked}`
    );

    record(
      results,
      "plan-e2e-mcp-no-project-id-in-result",
      !("projectId" in (allowed as Record<string, unknown>)),
      "report has no projectId field"
    );
  } finally {
    await reader.close();
    await store.close();
  }
}
