import { randomUUID } from "node:crypto";
import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const DEMO_ORG = process.env.KLM_DEMO_ORG_ID ?? "00000000-0000-4000-8000-000000000001";
const DEMO_WORKSPACE = process.env.KLM_DEMO_WORKSPACE_ID ?? "00000000-0000-4000-8000-000000000002";
const DEMO_PROJECT = process.env.KLM_DEMO_PROJECT_ID ?? "00000000-0000-4000-8000-000000000003";
const DEMO_USER = process.env.KLM_DEMO_USER_ID ?? "00000000-0000-4000-8000-000000000004";

function invariant(
  rule: string,
  reason: string,
  severity: "soft" | "hard" | "critical",
  appliesTo: string[]
) {
  return {
    id: randomUUID(),
    projectId: DEMO_PROJECT,
    rule,
    reason,
    severity,
    appliesTo,
    createdAt: new Date().toISOString(),
  };
}

const projectState = {
  id: DEMO_PROJECT,
  workspaceId: DEMO_WORKSPACE,
  name: "KLM Runtime",
  description:
    "Stateful AI intelligence platform — model is replaceable; memory, state, decisions, and invariants persist.",
  goals: [
    "Prove request → memory → model → verification → audit pipeline",
    "Shared PostgreSQL store for API and MCP",
    "Production-grade persistence before SSO/RBAC",
  ],
  businessModel: ["B2B SaaS", "BYOK model routing", "Usage-based billing"],
  architecture: {
    summary: "Client → KLM Gateway → Runtime (memory, verifier) → Model Router → providers",
    components: [
      { id: "api", name: "API Gateway", role: "HTTP entry (OpenAI-compat + native)", dependencies: ["runtime"] },
      { id: "mcp", name: "MCP Server", role: "IDE client (Cursor)", dependencies: ["runtime"] },
      { id: "runtime", name: "KlmRuntime", role: "Reasoning loop", dependencies: ["store", "router"] },
      { id: "store", name: "PostgreSQL StateStore", role: "Shared memory", dependencies: [] },
      { id: "router", name: "ModelRouter", role: "Replaceable model backends", dependencies: ["audit"] },
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
    invariant("Model is replaceable", "LLM is compute; KLM owns memory and state", "critical", ["runtime", "router"]),
    invariant("Memory and state must persist", "Project intelligence survives across sessions", "critical", ["store"]),
    invariant("API and MCP must share the same store", "Cursor and HTTP see one project memory", "critical", ["api", "mcp"]),
    invariant("User events must not be duplicated", "User message saved once in runtime", "hard", ["runtime", "memory-core"]),
    invariant("Decisions and invariants must be deduplicated", "No duplicate architectural rules", "hard", ["store", "memory-core"]),
    invariant("Production tenancy requires fixed X-KLM headers", "No random UUID fallback in production", "critical", ["api", "mcp"]),
    invariant("Every model call must be audited", "model_calls row per generate/stream", "hard", ["router", "audit"]),
    invariant("Semantic memory must not duplicate chunks", "One chunk per project/type/source", "hard", ["semantic-memory"]),
    invariant("Every endpoint must have an auth policy", "Security and audit compliance", "critical", ["api"]),
    invariant("Every public endpoint must have rate limiting", "DDoS protection", "hard", ["api"]),
  ],
  decisions: [
    {
      id: randomUUID(),
      projectId: DEMO_PROJECT,
      decision: "Auth must be centralized",
      reason: ["Lower security risk", "Simpler audit", "Billing needs stable identity"],
      rejectedAlternatives: [{ option: "Auth per microservice", reason: "Inconsistent permissions" }],
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
      projectId: DEMO_PROJECT,
      decision: "PostgreSQL-first shared store for API and MCP",
      reason: ["Cross-process memory", "Production persistence", "Audit and semantic memory"],
      rejectedAlternatives: [{ option: "In-memory only", reason: "No shared state between processes" }],
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
      projectId: DEMO_PROJECT,
      title: "DDoS on public gateway",
      description: "Unprotected endpoints without rate limiting",
      severity: "high",
      linkedModules: ["api"],
      status: "open",
    },
    {
      id: randomUUID(),
      projectId: DEMO_PROJECT,
      title: "Semantic memory noise from duplicate chunks",
      description: "Vector retrieval degrades if upsert dedup fails",
      severity: "medium",
      linkedModules: ["semantic-memory"],
      status: "mitigated",
    },
  ],
  roadmap: [
    { id: randomUUID(), title: "Phase 2.2 e2e evals", status: "in_progress", priority: "high" },
    { id: randomUUID(), title: "model_calls dashboard", status: "planned", priority: "medium" },
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

const pool = new pg.Pool({ connectionString });

try {
  await pool.query(
    `INSERT INTO project_states (id, workspace_id, state, updated_at)
     VALUES ($1, $2, $3::jsonb, NOW())
     ON CONFLICT (id) DO UPDATE SET state = $3::jsonb, updated_at = NOW()`,
    [DEMO_PROJECT, DEMO_WORKSPACE, JSON.stringify(projectState)]
  );

  console.log("Seeded KLM Runtime project:", DEMO_PROJECT);
  console.log(`  invariants=${projectState.invariants.length} decisions=${projectState.decisions.length}`);
  console.log("Use these headers in API / MCP env:");
  console.log(`  X-KLM-Organization-Id: ${DEMO_ORG}`);
  console.log(`  X-KLM-Workspace-Id: ${DEMO_WORKSPACE}`);
  console.log(`  X-KLM-Project-Id: ${DEMO_PROJECT}`);
  console.log(`  X-KLM-User-Id: ${DEMO_USER}`);
} catch (err) {
  console.error("Seed failed:", err);
  process.exit(1);
} finally {
  await pool.end();
}
