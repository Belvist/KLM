#!/usr/bin/env node
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  createKlmApp,
  resolveProjectContext,
  newRequestId,
  type ResolvedProjectContext,
} from "@klm/bootstrap";
import { resolveMcpWorkspaceRoot } from "@klm/project-resolver";
import { CodebaseQueryReader, handleCodebaseSearch } from "@klm/codebase-indexer";
import { ImpactAnalyzer, handleImpactAnalyze } from "@klm/impact-analyzer";
import { PlanVerifier, handlePlanVerify } from "@klm/plan-verifier";
import { CodeVerifier, handleCodeVerify } from "@klm/code-verifier";

function loadEnv(): void {
  const runtimeRoot =
    process.env.KLM_RUNTIME_ROOT ??
    resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const envPath = join(runtimeRoot, ".env");
  if (existsSync(envPath)) {
    config({ path: envPath });
  }
}

loadEnv();

const workspaceRoot = resolveMcpWorkspaceRoot();

let projectCtx: ResolvedProjectContext;

try {
  projectCtx = await resolveProjectContext(workspaceRoot, {
    mcp: true,
    autoRegister: true,
  });
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[klm-mcp] fatal: ${msg}`);
  process.exit(1);
}

process.env.KLM_PROJECT_ID = projectCtx.manifest.projectId;

const ORG_ID = projectCtx.tenant.organizationId;
const WORKSPACE_ID = projectCtx.tenant.workspaceId;
const USER_ID = projectCtx.tenant.userId;
const PROJECT_ID = projectCtx.manifest.projectId;

console.error(
  `[klm-mcp] workspace=${workspaceRoot} project=${PROJECT_ID} index.files=${projectCtx.indexStats.files}`
);
if (!projectCtx.indexed) {
  console.error(
    `[klm-mcp] warn: no codebase index — run: pnpm index:codebase -- --root "${projectCtx.manifest.rootPath}"`
  );
}

const { store, runtime } = await createKlmApp();

const DATABASE_URL = process.env.DATABASE_URL;
const codebaseReader = DATABASE_URL ? new CodebaseQueryReader(DATABASE_URL) : null;
const impactAnalyzer =
  DATABASE_URL && codebaseReader
    ? new ImpactAnalyzer(codebaseReader, {
        getInvariants: (pid) => store.getInvariants(pid),
        getDecisions: (pid) => store.getDecisions(pid),
        getRisks: async (pid) => {
          const state = await store.getProjectState(pid);
          return state?.risks ?? [];
        },
      })
    : null;

const planVerifier = impactAnalyzer ? new PlanVerifier(impactAnalyzer) : null;
const codeVerifier = impactAnalyzer ? new CodeVerifier(impactAnalyzer) : null;

const server = new McpServer({
  name: "klm-runtime",
  version: "0.1.0",
});

function tenant() {
  return {
    organizationId: ORG_ID,
    workspaceId: WORKSPACE_ID,
    projectId: PROJECT_ID,
    userId: USER_ID,
    requestId: newRequestId(),
  };
}

server.resource("project-state", "project://state", async () => {
  const state = await store.getProjectState(tenant().projectId);
  return {
    contents: [
      {
        uri: "project://state",
        mimeType: "application/json",
        text: JSON.stringify(state, null, 2),
      },
    ],
  };
});

server.resource("project-decisions", "project://decisions", async () => {
  const decisions = await store.getDecisions(tenant().projectId);
  return {
    contents: [
      {
        uri: "project://decisions",
        mimeType: "application/json",
        text: JSON.stringify(decisions, null, 2),
      },
    ],
  };
});

server.resource("project-invariants", "project://invariants", async () => {
  const invariants = await store.getInvariants(tenant().projectId);
  return {
    contents: [
      {
        uri: "project://invariants",
        mimeType: "application/json",
        text: JSON.stringify(invariants, null, 2),
      },
    ],
  };
});

server.tool(
  "klm_project_status",
  "KLM link status: project id, index stats, memory availability",
  {},
  async () => {
    const pid = tenant().projectId;
    const [state, indexStats] = await Promise.all([
      store.getProjectState(pid),
      resolveProjectContext(workspaceRoot, { mcp: true, autoRegister: false }),
    ]);

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              workspaceRoot,
              manifest: projectCtx.manifest,
              index: indexStats.indexStats,
              indexed: indexStats.indexed,
              projectRegistered: Boolean(state),
              projectName: state?.name ?? projectCtx.manifest.name,
              invariants: state?.invariants.length ?? 0,
              decisions: state?.decisions.length ?? 0,
              codebaseActivation: process.env.KLM_CODEBASE_ACTIVATION === "true",
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

server.tool(
  "klm_analyze_task",
  "Analyze a task through KLM Runtime (intent, memory, verification)",
  { input: z.string().describe("Task description") },
  async ({ input }) => {
    const response = await runtime.handleRequest({
      tenant: tenant(),
      client: "mcp",
      input,
      stream: false,
    });

    return {
      content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }],
    };
  }
);

server.tool(
  "klm_get_project_memory",
  "Get activated project memory: decisions, invariants, state",
  {},
  async () => {
    const pid = tenant().projectId;
    const [state, decisions, invariants, events] = await Promise.all([
      store.getProjectState(pid),
      store.getDecisions(pid),
      store.getInvariants(pid),
      store.getEvents(pid, 20),
    ]);

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ state, decisions, invariants, recentEvents: events }, null, 2),
        },
      ],
    };
  }
);

server.tool(
  "klm_search_codebase",
  "Search indexed codebase: files, routes, symbols, dependencies (requires DATABASE_URL + prior index:codebase)",
  {
    query: z.string().describe("Search term (path fragment, route, symbol name, import module)"),
    kind: z
      .enum(["all", "files", "routes", "symbols", "dependencies"])
      .optional()
      .describe("Limit search to one category (default: all)"),
    limit: z.number().int().min(1).max(100).optional().describe("Max results per category"),
  },
  async ({ query, kind, limit }) => {
    const result = await handleCodebaseSearch(codebaseReader, tenant().projectId, {
      query,
      kind,
      limit,
    });

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  }
);

server.tool(
  "klm_analyze_impact",
  "Read-only impact analysis: affected files/routes/symbols, related invariants/decisions, risks, test hints (metadata only)",
  {
    task: z.string().describe("Task description to analyze"),
    limit: z.number().int().min(1).max(100).optional().describe("Max items per category"),
  },
  async ({ task, limit }) => {
    const result = await handleImpactAnalyze(impactAnalyzer, tenant().projectId, {
      task,
      limit,
    });

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  }
);

const planStepSchema = z.object({
  steps: z.array(z.string()).min(1).max(50),
  files: z.array(z.string()).max(100).optional(),
  routes: z
    .array(z.object({ httpMethod: z.string(), path: z.string() }))
    .max(50)
    .optional(),
  tests: z.array(z.string()).max(50).optional(),
});

server.tool(
  "klm_verify_plan",
  "Verify implementation plan against impact report and invariants (read-only verdict)",
  {
    task: z.string().describe("Task description (same as impact analysis)"),
    plan: planStepSchema.describe("Implementation plan: steps, optional files/routes/tests"),
    limit: z.number().int().min(1).max(100).optional().describe("Max impact items per category"),
  },
  async ({ task, plan, limit }) => {
    const result = await handlePlanVerify(planVerifier, tenant().projectId, {
      task,
      plan,
      limit,
    });

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  }
);

const implementationSchema = z.object({
  summary: z.string().describe("Implementation summary (not full file dump)"),
  files: z.array(z.string()).max(100).optional(),
  routes: z
    .array(z.object({ httpMethod: z.string(), path: z.string() }))
    .max(50)
    .optional(),
  tests: z.array(z.string()).max(50).optional(),
});

server.tool(
  "klm_verify_code",
  "Verify implemented code/summary against impact, invariants, and optional plan report (read-only)",
  {
    task: z.string().describe("Task description (same as impact/plan analysis)"),
    implementation: implementationSchema.describe(
      "What was implemented: summary, optional files/routes/tests"
    ),
    limit: z.number().int().min(1).max(100).optional().describe("Max impact items per category"),
    planReport: z
      .object({
        verdict: z.enum(["safe", "needs_changes", "blocked"]),
        missingTests: z.array(z.string()).optional(),
        requiredChanges: z.array(z.string()).optional(),
      })
      .optional()
      .describe("Optional prior plan verification summary for cross-check"),
  },
  async ({ task, implementation, limit, planReport }) => {
    const normalizedPlanReport = planReport
      ? {
          taskPreview: "",
          taskHash: "",
          planPreview: "",
          planHash: "",
          verdict: planReport.verdict,
          violations: [],
          missingTests: planReport.missingTests ?? [],
          riskNotes: [],
          requiredChanges: planReport.requiredChanges ?? [],
          confidence: "medium" as const,
          impactConfidence: "medium" as const,
          metadataOnly: true as const,
        }
      : undefined;

    const result = await handleCodeVerify(codeVerifier, tenant().projectId, {
      task,
      implementation,
      limit,
      planReport: normalizedPlanReport,
    });

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  }
);

server.prompt(
  "klm-plan",
  "Create an implementation plan using KLM project memory",
  {
    task: z.string().optional(),
  },
  ({ task }) => ({
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `Plan using KLM project state:\n${task ?? ""}`,
        },
      },
    ],
  })
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `KLM MCP running — project ${PROJECT_ID} (${projectCtx.manifest.name}), store=${DATABASE_URL ? "postgres" : "file"}`
  );

  process.on("SIGINT", async () => {
    await codebaseReader?.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
