#!/usr/bin/env node
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const pg = require(
  join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "packages",
    "state-store",
    "node_modules",
    "pg"
  )
);

const __dirname = dirname(fileURLToPath(import.meta.url));
const klmRoot = join(__dirname, "..");

function loadEnv() {
  const envPath = join(klmRoot, ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim();
    if (k && process.env[k] === undefined) process.env[k] = v;
  }
}

loadEnv();

const projectId =
  process.argv[2] ?? process.env.KLM_MUSIC_PROJECT_ID ?? "00000000-0000-4000-8000-000000000105";
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error("DATABASE_URL required");
  process.exit(1);
}

const { findPlatformMemoryLeaks, hasEarflowMemory } = await import(
  pathToFileURL(join(klmRoot, "packages", "memory-core", "dist", "platform-isolation.js")).href
);

const pool = new pg.Pool({ connectionString });
const res = await pool.query(`SELECT state FROM project_states WHERE id = $1`, [projectId]);
await pool.end();

if (!res.rows[0]) {
  console.error(`Project not found: ${projectId}`);
  process.exit(1);
}

const state = res.rows[0].state;
const leaks = findPlatformMemoryLeaks(state);
const earflow = hasEarflowMemory(state);

console.log(`Project: ${projectId} (${state.name ?? "?"})`);
console.log(`  invariants: ${state.invariants?.length ?? 0}`);
console.log(`  decisions: ${state.decisions?.length ?? 0}`);
console.log(`  INV-FE present: ${earflow}`);

if (leaks.length) {
  console.error("\nFAILED — KLM platform memory leaked:");
  for (const leak of leaks) console.error(`  - ${leak}`);
  process.exit(1);
}

if (!earflow) {
  console.error("\nFAILED — no INV-FE invariants. Run: pnpm klm:import-docs");
  process.exit(1);
}

console.log("\nOK — project isolation smoke passed");
