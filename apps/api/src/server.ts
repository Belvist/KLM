import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { createKlmApp, extractTenant, TenantValidationError } from "@klm/bootstrap";
import type { ClientType, ConversationMessage, KlmRequest } from "@klm/core";
import { buildConversationContext, lastUserMessage } from "@klm/core";

const PORT = Number(process.env.KLM_PORT ?? 3100);
const HOST = process.env.KLM_HOST ?? "0.0.0.0";
const API_KEY = process.env.KLM_API_KEY ?? "klm_dev_key_change_me";

const { store, runtime } = await createKlmApp();

const app = Fastify({ logger: true });

function authenticate(authHeader?: string): boolean {
  if (!authHeader?.startsWith("Bearer ")) return false;
  return authHeader.slice(7) === API_KEY;
}

app.addHook("onRequest", async (request, reply) => {
  if (request.url === "/health") return;
  if (!authenticate(request.headers.authorization)) {
    return reply.code(401).send({ error: "Unauthorized" });
  }
});

app.setErrorHandler((error, _request, reply) => {
  if (error instanceof TenantValidationError) {
    return reply.code(error.statusCode).send({ error: error.message });
  }
  throw error;
});

app.get("/health", async () => ({
  status: "ok",
  service: "klm-gateway",
  store: process.env.DATABASE_URL ? "postgres" : process.env.KLM_STORE_BACKEND ?? "file",
}));

app.post<{ Body: { input: string; model?: string; client?: ClientType } }>(
  "/v1/klm/completions",
  async (request) => {
    const tenant = extractTenant(request.headers);
    const klmRequest: KlmRequest = {
      tenant,
      client: request.body.client ?? "api",
      input: request.body.input,
      modelOverride: request.body.model,
      stream: false,
    };
    return runtime.handleRequest(klmRequest);
  }
);

app.post<{
  Body: {
    model?: string;
    messages: Array<{ role: string; content: string }>;
    stream?: boolean;
  };
}>("/v1/chat/completions", async (request, reply) => {
  const tenant = extractTenant(request.headers);
  const rawMessages = request.body.messages ?? [];
  const messageHistory: ConversationMessage[] = rawMessages.map((m) => ({
    role: m.role as ConversationMessage["role"],
    content: m.content,
  }));

  const input = lastUserMessage(messageHistory);
  const klmRequest: KlmRequest = {
    tenant,
    client: "openai_compat",
    input,
    messageHistory,
    modelOverride: request.body.model,
    stream: request.body.stream ?? false,
  };

  if (request.body.stream) {
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const id = `chatcmpl-${randomUUID()}`;
    for await (const chunk of runtime.handleRequestStream(klmRequest)) {
      if (chunk.type === "chunk" && chunk.content) {
        const payload = {
          id,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: request.body.model ?? "klm-runtime",
          choices: [{ index: 0, delta: { content: chunk.content }, finish_reason: null }],
        };
        reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
      }
      if (chunk.type === "done") {
        reply.raw.write("data: [DONE]\n\n");
      }
    }
    reply.raw.end();
    return reply;
  }

  const response = await runtime.handleRequest(klmRequest);

  return {
    id: `chatcmpl-${randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: response.modelUsed,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: response.output },
        finish_reason: "stop",
      },
    ],
    usage: response.usage,
    klm: {
      verificationPassed: response.verificationPassed,
      warnings: response.warnings,
      provider: response.providerUsed,
      contextMessages: messageHistory.length,
      recentContextLines: buildConversationContext(messageHistory).length,
    },
  };
});

app.get("/v1/projects/:projectId/state", async (request) => {
  const { projectId } = request.params as { projectId: string };
  const state = await store.getProjectState(projectId);
  return state ?? { error: "Project not found" };
});

app.get("/v1/projects/:projectId/decisions", async (request) => {
  const { projectId } = request.params as { projectId: string };
  return store.getDecisions(projectId);
});

app.get("/v1/projects/:projectId/invariants", async (request) => {
  const { projectId } = request.params as { projectId: string };
  return store.getInvariants(projectId);
});

async function main() {
  await app.listen({ port: PORT, host: HOST });
  console.log(`KLM Gateway listening on http://${HOST}:${PORT}`);
  console.log(`Store: ${process.env.DATABASE_URL ? "postgres" : process.env.KLM_STATE_PATH ?? ".klm-data"}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
