#!/usr/bin/env node
/**
 * Show KLM project identity and stats for a workspace.
 * Usage: pnpm klm:project -- --root <path>
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const klmRoot = resolve(__dirname, "..");

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

function parseArgs(argv) {
  let root = process.cwd();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--" && argv[i + 1]) root = resolve(argv[++i]);
    else if (arg === "--root" && argv[i + 1]) root = resolve(argv[++i]);
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: pnpm klm:project -- --root <path>`);
      process.exit(0);
    } else if (arg !== "--" && !arg.startsWith("-")) {
      root = resolve(arg);
    }
  }
  return { root };
}

loadEnv();
const { root } = parseArgs(process.argv.slice(2));

const resolverDist = join(klmRoot, "packages", "project-resolver", "dist", "index.js");
if (!existsSync(resolverDist)) {
  console.error("Run pnpm --filter @klm/project-resolver build first");
  process.exit(1);
}

const { resolveForCli, getProjectStats, ProjectNotInitializedError } = await import(
  pathToFileURL(resolverDist).href
);

try {
  const resolved = resolveForCli(root);
  const m = resolved.manifest;

  console.log(`Project: ${m.name}`);
  console.log(`ProjectId: ${m.projectId}`);
  console.log(`Fingerprint: ${m.rootFingerprint}`);
  if (m.gitRemote) console.log(`Git remote: ${m.gitRemote}`);
  console.log(`Root: ${m.rootPath}`);

  if (process.env.DATABASE_URL) {
    const stats = await getProjectStats(process.env.DATABASE_URL, m.projectId);
    console.log(`Indexed files: ${stats.files}`);
    console.log(`Routes: ${stats.routes}`);
    console.log(`Symbols: ${stats.symbols}`);
    console.log(`Invariants: ${stats.invariants}`);
    console.log(`Decisions: ${stats.decisions}`);
  }
} catch (err) {
  if (err instanceof ProjectNotInitializedError) {
    console.error(`Error: ${err.code} — ${err.message}`);
    process.exit(1);
  }
  throw err;
}
