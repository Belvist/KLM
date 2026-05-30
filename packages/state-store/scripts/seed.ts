import { randomUUID } from "node:crypto";
import pg from "pg";
import { loadRootEnv } from "./load-env.js";

loadRootEnv();

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const DEMO_ORG = process.env.KLM_DEMO_ORG_ID ?? "00000000-0000-4000-8000-000000000001";
const DEMO_WORKSPACE = process.env.KLM_DEMO_WORKSPACE_ID ?? "00000000-0000-4000-8000-000000000002";
const DEMO_PROJECT = process.env.KLM_DEMO_PROJECT_ID ?? "00000000-0000-4000-8000-000000000003";
const DEMO_USER = process.env.KLM_DEMO_USER_ID ?? "00000000-0000-4000-8000-000000000004";
const LIVE_PROJECT = process.env.KLM_LIVE_PROJECT_ID ?? "00000000-0000-4000-8000-000000000005";
const MUSIC_PROJECT = process.env.KLM_MUSIC_PROJECT_ID ?? "00000000-0000-4000-8000-000000000105";

function makeInvariant(
  projectId: string,
  rule: string,
  reason: string,
  severity: "soft" | "hard" | "critical",
  appliesTo: string[]
) {
  return {
    id: randomUUID(),
    projectId,
    rule,
    reason,
    severity,
    appliesTo,
    createdAt: new Date().toISOString(),
  };
}

function buildProjectState(
  projectId: string,
  workspaceId: string,
  name: string,
  description: string
) {
  return {
    id: projectId,
    workspaceId,
    name,
    description,
    goals: [
      "Prove request → memory → model → verification → audit pipeline",
      "Shared PostgreSQL store for API and MCP",
      "Production-grade persistence before SSO/RBAC",
    ],
    businessModel: ["B2B SaaS", "BYOK model routing", "Usage-based billing"],
    architecture: {
      summary: "Client → KLM Gateway → Runtime (memory, verifier) → Model Router → providers",
      components: [
        {
          id: "api",
          name: "API Gateway",
          role: "HTTP entry (OpenAI-compat + native)",
          dependencies: ["runtime"],
        },
        { id: "mcp", name: "MCP Server", role: "IDE client (Cursor)", dependencies: ["runtime"] },
        {
          id: "runtime",
          name: "KlmRuntime",
          role: "Reasoning loop",
          dependencies: ["store", "router"],
        },
        { id: "store", name: "PostgreSQL StateStore", role: "Shared memory", dependencies: [] },
        {
          id: "router",
          name: "ModelRouter",
          role: "Replaceable model backends",
          dependencies: ["audit"],
        },
      ],
      dataFlows: [
        { from: "api", to: "runtime", description: "KlmRequest with tenant context" },
        { from: "mcp", to: "runtime", description: "Same store, same project state" },
        { from: "runtime", to: "store", description: "Events, decisions, invariants" },
        { from: "router", to: "audit", description: "model_calls telemetry" },
      ],
    },
    techStack: {
      languages: ["TypeScript"],
      frameworks: ["Fastify", "MCP SDK"],
      databases: ["PostgreSQL", "pgvector"],
      infra: ["Docker", "GitHub Actions"],
      tools: ["pnpm", "Zod"],
    },
    invariants: [
      makeInvariant(
        projectId,
        "Model is replaceable",
        "LLM is compute; KLM owns memory and state",
        "critical",
        ["runtime", "router"]
      ),
      makeInvariant(
        projectId,
        "Memory and state must persist",
        "Project intelligence survives across sessions",
        "critical",
        ["store"]
      ),
      makeInvariant(
        projectId,
        "API and MCP must share the same store",
        "Cursor and HTTP see one project memory",
        "critical",
        ["api", "mcp"]
      ),
      makeInvariant(
        projectId,
        "User events must not be duplicated",
        "User message saved once in runtime",
        "hard",
        ["runtime", "memory-core"]
      ),
      makeInvariant(
        projectId,
        "Decisions and invariants must be deduplicated",
        "No duplicate architectural rules",
        "hard",
        ["store", "memory-core"]
      ),
      makeInvariant(
        projectId,
        "Production tenancy requires fixed X-KLM headers",
        "No random UUID fallback in production",
        "critical",
        ["api", "mcp"]
      ),
      makeInvariant(
        projectId,
        "Every model call must be audited",
        "model_calls row per generate/stream",
        "hard",
        ["router", "audit"]
      ),
      makeInvariant(
        projectId,
        "Semantic memory must not duplicate chunks",
        "One chunk per project/type/source",
        "hard",
        ["semantic-memory"]
      ),
      makeInvariant(
        projectId,
        "Every endpoint must have an auth policy",
        "Security and audit compliance",
        "critical",
        ["api"]
      ),
      makeInvariant(
        projectId,
        "Every public endpoint must have rate limiting",
        "DDoS protection",
        "hard",
        ["api"]
      ),
    ],
    decisions: [
      {
        id: randomUUID(),
        projectId,
        decision: "Auth must be centralized",
        reason: ["Lower security risk", "Simpler audit", "Billing needs stable identity"],
        rejectedAlternatives: [
          { option: "Auth per microservice", reason: "Inconsistent permissions" },
        ],
        consequencesExpected: ["All endpoints pass AuthBoundary"],
        consequencesObserved: [],
        linkedFiles: [],
        linkedModules: ["auth"],
        linkedRisks: [],
        status: "active",
        createdAt: new Date().toISOString(),
      },
      {
        id: randomUUID(),
        projectId,
        decision: "PostgreSQL-first shared store for API and MCP",
        reason: ["Cross-process memory", "Production persistence", "Audit and semantic memory"],
        rejectedAlternatives: [
          { option: "In-memory only", reason: "No shared state between processes" },
        ],
        consequencesExpected: ["API and MCP see same project_states and events"],
        consequencesObserved: [],
        linkedFiles: [],
        linkedModules: ["state-store"],
        linkedRisks: [],
        status: "active",
        createdAt: new Date().toISOString(),
      },
    ],
    risks: [
      {
        id: randomUUID(),
        projectId,
        title: "DDoS on public gateway",
        description: "Unprotected endpoints without rate limiting",
        severity: "high",
        linkedModules: ["api"],
        status: "open",
      },
      {
        id: randomUUID(),
        projectId,
        title: "Semantic memory noise from duplicate chunks",
        description: "Vector retrieval degrades if upsert dedup fails",
        severity: "medium",
        linkedModules: ["semantic-memory"],
        status: "mitigated",
      },
    ],
    roadmap: [
      {
        id: randomUUID(),
        title: "Phase 2.3 observability endpoints",
        status: "in_progress",
        priority: "high",
      },
      {
        id: randomUUID(),
        title: "Phase 2.4 codebase indexer",
        status: "planned",
        priority: "medium",
      },
      { id: randomUUID(), title: "SSO / RBAC", status: "planned", priority: "low" },
    ],
    codebaseMap: {
      rootPath: ".",
      fileCount: 120,
      modules: [
        { path: "packages/runtime", purpose: "KlmRuntime reasoning loop" },
        { path: "apps/api", purpose: "HTTP gateway" },
        { path: "apps/mcp-server", purpose: "MCP IDE client" },
      ],
    },
    updatedAt: new Date().toISOString(),
  };
}

/** External repos (music-platform) — empty structured memory; fill via klm:import-docs. */
function buildExternalProjectState(
  projectId: string,
  workspaceId: string,
  name: string,
  rootPath: string,
  description: string
) {
  return {
    id: projectId,
    workspaceId,
    name,
    description,
    goals: ["Persistent project memory via KLM — decisions and invariants from repo docs"],
    businessModel: [],
    architecture: {
      summary: "Cursor/MCP → KLM Runtime → PostgreSQL project memory + codebase index",
      components: [],
      dataFlows: [],
    },
    techStack: {
      languages: [],
      frameworks: [],
      databases: ["PostgreSQL"],
      infra: [],
      tools: ["KLM Runtime"],
    },
    invariants: [],
    decisions: [],
    risks: [],
    roadmap: [],
    codebaseMap: {
      rootPath,
      fileCount: 0,
      modules: [],
    },
    updatedAt: new Date().toISOString(),
  };
}

const demoState = buildProjectState(
  DEMO_PROJECT,
  DEMO_WORKSPACE,
  "KLM Runtime Demo",
  "Mock/e2e project — record:demo and eval:e2e write here; isolated from live Cursor work."
);

const liveState = buildProjectState(
  LIVE_PROJECT,
  DEMO_WORKSPACE,
  "KLM Runtime Live",
  "KLM Runtime MCP/API sessions — not external repos."
);

const musicState = buildExternalProjectState(
  MUSIC_PROJECT,
  DEMO_WORKSPACE,
  "music-platform",
  process.env.KLM_MUSIC_PLATFORM_ROOT ?? "C:\\Users\\Heave\\Downloads\\music-platform",
  "Earflow music-platform — structured memory from docs/DECISIONS.md + ARCHITECTURE_INVARIANTS.md"
);

const pool = new pg.Pool({ connectionString });

async function seedProject(
  projectId: string,
  workspaceId: string,
  state: ReturnType<typeof buildProjectState>
) {
  await pool.query(
    `INSERT INTO project_states (id, workspace_id, state, updated_at)
     VALUES ($1, $2, $3::jsonb, NOW())
     ON CONFLICT (id) DO UPDATE SET state = $3::jsonb, updated_at = NOW()`,
    [projectId, workspaceId, JSON.stringify(state)]
  );
  console.log(`Seeded project: ${projectId} (${state.name})`);
  console.log(`  invariants=${state.invariants.length} decisions=${state.decisions.length}`);
}

try {
  await seedProject(DEMO_PROJECT, DEMO_WORKSPACE, demoState);
  await seedProject(LIVE_PROJECT, DEMO_WORKSPACE, liveState);
  await seedProject(MUSIC_PROJECT, DEMO_WORKSPACE, musicState);

  console.log("\nDemo project (e2e, record:demo):");
  console.log(`  X-KLM-Project-Id: ${DEMO_PROJECT}`);
  console.log("\nKLM Runtime live (record:live, klm-runtime MCP when developing KLM itself):");
  console.log(`  X-KLM-Project-Id: ${LIVE_PROJECT}`);
  console.log("\nMusic-platform / external repo (Earflow — isolated from KLM seed):");
  console.log(`  X-KLM-Project-Id: ${MUSIC_PROJECT}`);
  console.log("\nShared tenant headers:");
  console.log(`  X-KLM-Organization-Id: ${DEMO_ORG}`);
  console.log(`  X-KLM-Workspace-Id: ${DEMO_WORKSPACE}`);
  console.log(`  X-KLM-User-Id: ${DEMO_USER}`);
} catch (err) {
  console.error("Seed failed:", err);
  process.exit(1);
} finally {
  await pool.end();
}
