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

const projectState = {
  id: DEMO_PROJECT,
  workspaceId: DEMO_WORKSPACE,
  name: "KLM Demo Project",
  description: "Seeded production-style project for local development",
  goals: ["Build API gateway with auth", "Maintain architectural integrity"],
  businessModel: ["B2B SaaS", "Usage-based billing"],
  architecture: {
    summary: "Modular monolith migrating to services",
    components: [
      { id: "api", name: "API Gateway", role: "HTTP entry", dependencies: ["auth", "billing"] },
      { id: "auth", name: "Auth Service", role: "Identity", dependencies: [] },
    ],
    dataFlows: [{ from: "api", to: "auth", description: "JWT validation" }],
  },
  techStack: {
    languages: ["TypeScript"],
    frameworks: ["Fastify"],
    databases: ["PostgreSQL"],
    infra: ["Docker"],
    tools: ["pnpm"],
  },
  invariants: [
    {
      id: randomUUID(),
      projectId: DEMO_PROJECT,
      rule: "Every endpoint must have an auth policy",
      reason: "Security and audit compliance",
      severity: "critical",
      appliesTo: ["api", "gateway"],
      createdAt: new Date().toISOString(),
    },
    {
      id: randomUUID(),
      projectId: DEMO_PROJECT,
      rule: "Every public endpoint must have rate limiting",
      reason: "DDoS protection",
      severity: "hard",
      appliesTo: ["api"],
      createdAt: new Date().toISOString(),
    },
  ],
  decisions: [
    {
      id: randomUUID(),
      projectId: DEMO_PROJECT,
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
  ],
  risks: [
    {
      id: randomUUID(),
      projectId: DEMO_PROJECT,
      title: "DDoS on public gateway",
      description: "Unprotected endpoints",
      severity: "high",
      linkedModules: ["api"],
      status: "open",
    },
  ],
  roadmap: [],
  codebaseMap: { rootPath: ".", fileCount: 0, modules: [] },
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

  console.log("Seeded demo project:", DEMO_PROJECT);
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
