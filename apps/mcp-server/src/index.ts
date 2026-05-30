#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createKlmApp, getKlmEnvironment } from "@klm/bootstrap";
import { CodebaseQueryReader, handleCodebaseSearch } from "@klm/codebase-indexer";

const PROJECT_ID = process.env.KLM_PROJECT_ID ?? "";
const WORKSPACE_ID = process.env.KLM_WORKSPACE_ID ?? "";
const USER_ID = process.env.KLM_USER_ID ?? "";
const ORG_ID = process.env.KLM_ORGANIZATION_ID ?? "";

const env = getKlmEnvironment();
if (!PROJECT_ID || !WORKSPACE_ID || !USER_ID) {
  const msg =
    "KLM MCP requires KLM_PROJECT_ID, KLM_WORKSPACE_ID, KLM_USER_ID (fixed UUIDs, shared with API)";
  if (env === "production") {
    console.error(msg);
    process.exit(1);
  }
  console.error(`[warn] ${msg} — using dev defaults`);
}

const { store, runtime } = await createKlmApp();

const DATABASE_URL = process.env.DATABASE_URL;
const codebaseReader = DATABASE_URL ? new CodebaseQueryReader(DATABASE_URL) : null;

const server = new McpServer({
  name: "klm-runtime",
  version: "0.1.0",
});

function tenant() {
  return {
    organizationId: ORG_ID || "00000000-0000-4000-8000-000000000001",
    workspaceId: WORKSPACE_ID || "00000000-0000-4000-8000-000000000002",
    projectId: PROJECT_ID || "00000000-0000-4000-8000-000000000003",
    userId: USER_ID || "00000000-0000-4000-8000-000000000004",
    requestId: randomUUID(),
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
  "klm_verify_code",
  "Verify code or architecture against project invariants",
  { content: z.string().describe("Code or architecture to verify") },
  async ({ content }) => {
    const invariants = await store.getInvariants(tenant().projectId);
    const violations = invariants
      .filter((inv) => {
        const lower = content.toLowerCase();
        if (inv.rule.toLowerCase().includes("auth") && lower.includes("endpoint")) {
          return !lower.includes("auth");
        }
        return false;
      })
      .map((inv) => inv.rule);

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ passed: violations.length === 0, violations }, null, 2),
        },
      ],
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
  console.error("KLM MCP Server running (shared store with API via KLM_STATE_PATH / DATABASE_URL)");

  process.on("SIGINT", async () => {
    await codebaseReader?.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
