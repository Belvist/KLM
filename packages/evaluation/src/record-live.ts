/** One real OpenRouter call through KlmRuntime — loads klm-runtime/.env */
import { randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createKlmApp, resetKlmAppForTests } from "@klm/bootstrap";

function loadEnv(): void {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const envPath = join(root, ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim();
    if (k && process.env[k] === undefined) process.env[k] = v;
  }
}

async function main(): Promise<void> {
  loadEnv();

  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL required");
    process.exit(1);
  }
  if (!process.env.OPENROUTER_API_KEY) {
    console.error("OPENROUTER_API_KEY required in .env");
    process.exit(1);
  }

  resetKlmAppForTests();
  const { runtime } = await createKlmApp({ reset: true });

  const LIVE_PROJECT = process.env.KLM_LIVE_PROJECT_ID ?? "00000000-0000-4000-8000-000000000005";

  const response = await runtime.handleRequest({
    tenant: {
      organizationId: "00000000-0000-4000-8000-000000000001",
      workspaceId: "00000000-0000-4000-8000-000000000002",
      projectId: LIVE_PROJECT,
      userId: "00000000-0000-4000-8000-000000000004",
      requestId: randomUUID(),
    },
    client: "api",
    input:
      "Briefly: what are the top 3 KLM Runtime invariants for Phase 2.3 observability? Do not propose code changes.",
    stream: false,
  });

  console.log("OK model:", response.modelUsed);
  console.log("Live project:", LIVE_PROJECT);
  console.log("Output:", response.output.slice(0, 300));
  console.log("memoryUpdated:", response.memoryUpdated);
}

main().catch((e) => {
  console.error("FAILED:", (e as Error).message);
  process.exit(1);
});
