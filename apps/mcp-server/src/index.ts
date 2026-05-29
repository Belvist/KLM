#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ModelRouter } from "@klm/model-adapters";
import { KlmRuntime } from "@klm/runtime";
import { InMemoryStateStore } from "@klm/state-store";

const store = new InMemoryStateStore();
const router = new ModelRouter();
const runtime = new KlmRuntime({ store, router });

const PROJECT_ID = process.env.KLM_PROJECT_ID ?? randomUUID();
const WORKSPACE_ID = process.env.KLM_WORKSPACE_ID ?? randomUUID();
const USER_ID = process.env.KLM_USER_ID ?? randomUUID();
const ORG_ID = process.env.KLM_ORGANIZATION_ID ?? randomUUID();

const server = new McpServer({
  name: "klm-runtime",
  version: "0.1.0",
});

server.resource("project-state", "project://state", async () => {
  const state = await store.getProjectState(PROJECT_ID);
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
  const decisions = await store.getDecisions(PROJECT_ID);
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
  const invariants = await store.getInvariants(PROJECT_ID);
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
      tenant: {
        organizationId: ORG_ID,
        workspaceId: WORKSPACE_ID,
        projectId: PROJECT_ID,
        userId: USER_ID,
        requestId: randomUUID(),
      },
      client: "mcp",
      input,
      stream: false,
    });

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(response, null, 2),
        },
      ],
    };
  }
);

server.tool(
  "klm_get_project_memory",
  "Get activated project memory: decisions, invariants, state",
  {},
  async () => {
    const [state, decisions, invariants] = await Promise.all([
      store.getProjectState(PROJECT_ID),
      store.getDecisions(PROJECT_ID),
      store.getInvariants(PROJECT_ID),
    ]);

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ state, decisions, invariants }, null, 2),
        },
      ],
    };
  }
);

server.tool(
  "klm_verify_code",
  "Verify code or architecture against project invariants",
  {
    content: z.string().describe("Code or architecture to verify"),
  },
  async ({ content }) => {
    const invariants = await store.getInvariants(PROJECT_ID);
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
  { task: z.string().optional() },
  ({ task }) => ({
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `Plan the following task using KLM project state, decisions, and invariants:\n${task ?? ""}`,
        },
      },
    ],
  })
);

server.prompt(
  "klm-implement",
  "Implement with KLM production-grade standards",
  { task: z.string().optional() },
  ({ task }) => ({
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `Implement with architecture check, tests, observability:\n${task ?? ""}`,
        },
      },
    ],
  })
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("KLM MCP Server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
