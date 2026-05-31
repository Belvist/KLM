#!/usr/bin/env node
/**
 * One-time bootstrap: link any repo to KLM (MCP + rules + .klm/project.json).
 * Usage: pnpm klm:init -- --root <path> [--project-id <uuid>] [--klm-root <path>]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const klmRootDefault = resolve(__dirname, "..");

function parseArgs(argv) {
  let workspaceRoot = process.cwd();
  let projectId = "";
  let klmRuntimeRoot = klmRootDefault;
  let repair = false;
  let force = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--" && argv[i + 1]) {
      workspaceRoot = resolve(argv[++i]);
    } else if (arg === "--root" && argv[i + 1]) {
      workspaceRoot = resolve(argv[++i]);
    } else if (arg === "--project-id" && argv[i + 1]) {
      projectId = argv[++i];
    } else if (arg === "--klm-root" && argv[i + 1]) {
      klmRuntimeRoot = resolve(argv[++i]);
    } else if (arg === "--repair") {
      repair = true;
    } else if (arg === "--force") {
      force = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        `Usage: pnpm klm:init -- --root <path> [--project-id <uuid>] [--repair] [--force]`
      );
      process.exit(0);
    } else if (arg !== "--" && !arg.startsWith("-")) {
      workspaceRoot = resolve(arg);
    }
  }

  return { workspaceRoot, projectId, klmRuntimeRoot, repair, force };
}

function loadEnvKey(envPath, key) {
  if (!existsSync(envPath)) return "";
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    if (t.slice(0, eq).trim() === key) return t.slice(eq + 1).trim();
  }
  return "";
}

const { workspaceRoot, projectId, klmRuntimeRoot, repair, force } = parseArgs(
  process.argv.slice(2)
);

if (!existsSync(workspaceRoot)) {
  console.error(`Workspace not found: ${workspaceRoot}`);
  process.exit(1);
}

const envPath = join(klmRuntimeRoot, ".env");
for (const [key, val] of Object.entries({
  DATABASE_URL: loadEnvKey(envPath, "DATABASE_URL"),
  KLM_ORGANIZATION_ID:
    loadEnvKey(envPath, "KLM_ORGANIZATION_ID") || "00000000-0000-4000-8000-000000000001",
  KLM_WORKSPACE_ID:
    loadEnvKey(envPath, "KLM_WORKSPACE_ID") || "00000000-0000-4000-8000-000000000002",
  KLM_USER_ID: loadEnvKey(envPath, "KLM_USER_ID") || "00000000-0000-4000-8000-000000000004",
})) {
  if (val && !process.env[key]) process.env[key] = val;
}

const resolverDist = join(klmRuntimeRoot, "packages", "project-resolver", "dist", "index.js");
if (!existsSync(resolverDist)) {
  console.error("Run pnpm --filter @klm/project-resolver build first");
  process.exit(1);
}

const { initProject, getProjectStats } = await import(pathToFileURL(resolverDist).href);

const init = await initProject({
  root: workspaceRoot,
  projectId: projectId || undefined,
  connectionString: process.env.DATABASE_URL,
  repair,
  force,
});

const stats = process.env.DATABASE_URL
  ? await getProjectStats(process.env.DATABASE_URL, init.manifest.projectId)
  : { files: 0, routes: 0, symbols: 0, invariants: 0, decisions: 0 };

console.log(`Project: ${init.manifest.name}`);
console.log(`ProjectId: ${init.manifest.projectId}`);
console.log(`Fingerprint: ${init.manifest.rootFingerprint}`);
if (init.manifest.gitRemote) console.log(`Git remote: ${init.manifest.gitRemote}`);
console.log(
  `Created: manifest=${init.created} projectRow=${init.projectRowCreated} state=${init.stateCreated}`
);
console.log(
  `Index: files=${stats.files} routes=${stats.routes} symbols=${stats.symbols} invariants=${stats.invariants} decisions=${stats.decisions}`
);

const openRouterKey = loadEnvKey(envPath, "OPENROUTER_API_KEY");
const cursorDir = join(workspaceRoot, ".cursor");
const rulesDir = join(cursorDir, "rules");
mkdirSync(rulesDir, { recursive: true });

const mcpJson = {
  mcpServers: {
    "klm-runtime": {
      command: "pnpm",
      args: ["--dir", join(klmRuntimeRoot, "apps", "mcp-server"), "dev"],
      env: {
        KLM_RUNTIME_ROOT: klmRuntimeRoot,
        KLM_WORKSPACE_ROOT: workspaceRoot,
        KLM_CODEBASE_ACTIVATION: "true",
        KLM_STORE_BACKEND: "postgres",
        DATABASE_URL:
          loadEnvKey(envPath, "DATABASE_URL") || "postgresql://klm:klm@localhost:5432/klm",
        KLM_ORGANIZATION_ID: "00000000-0000-4000-8000-000000000001",
        KLM_WORKSPACE_ID: "00000000-0000-4000-8000-000000000002",
        KLM_USER_ID: "00000000-0000-4000-8000-000000000004",
        KLM_DEFAULT_PROVIDER: loadEnvKey(envPath, "KLM_DEFAULT_PROVIDER") || "openrouter",
        KLM_DEFAULT_MODEL: loadEnvKey(envPath, "KLM_DEFAULT_MODEL") || "openrouter/owl-alpha",
        ...(openRouterKey ? { OPENROUTER_API_KEY: openRouterKey } : {}),
      },
    },
  },
};

writeFileSync(join(cursorDir, "mcp.json"), `${JSON.stringify(mcpJson, null, 2)}\n`, "utf-8");

const rule = `---
description: KLM MCP — project memory + codebase index (auto-linked)
alwaysApply: true
---

# KLM Auto Memory

This workspace is linked to **KLM Runtime** via \`.klm/project.json\`.

Project id: \`${init.manifest.projectId}\`

## At task start (READ)

1. Call **\`klm_project_status\`** then **\`klm_get_project_memory\`**.
2. Use **invariants** and **decisions** in every plan and code change.
3. Use **\`klm_search_codebase\`** before grepping large monorepos.

## Before code changes (IMPACT + VERIFY)

Before non-trivial code changes (refactor, new feature, multi-file edit):

1. Call **\`klm_analyze_impact\`** with the task description.
2. Call **\`klm_verify_plan\`** with the same task and implementation plan (steps, files, tests).
3. Do not write code until verdict is \`safe\` or required changes are addressed.

Impact and plan verify are read-only (metadata-only). They do not write memory.

## After writing code (CODE VERIFY)

When you have an implementation summary (not a full file dump):

1. Call **\`klm_verify_code\`** with \`task\` and \`implementation\` (summary, files?, tests?).
2. Optionally pass \`planReport\` for cross-check with plan verify.
3. Does **not** replace \`klm_verify_plan\`. \`pass\` ≠ production approval. Read-only.

Full flow: impact → verify_plan → code → verify_code → memory record.

## After significant work (WRITE)

- **\`klm_analyze_task\`**: "Record to project memory: …" (durable decisions only).

## Re-index after code changes

\`pnpm index:codebase -- --root "${workspaceRoot.replace(/\\/g, "/")}"\`

Agent mode required. MCP must show **klm-runtime** connected.
`;

writeFileSync(join(rulesDir, "klm-auto-memory.mdc"), rule, "utf-8");

console.log(`\nKLM linked: ${basename(workspaceRoot)}`);
console.log(`  .klm/project.json`);
console.log(`  .cursor/mcp.json`);
console.log(`\nNext: open "${workspaceRoot}" in Cursor → Reload MCP → Agent mode`);
