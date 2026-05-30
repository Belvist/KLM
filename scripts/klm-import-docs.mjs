#!/usr/bin/env node
/**
 * Import structured decisions/invariants from project docs into KLM Postgres.
 * Usage: pnpm klm:import-docs -- --root <repo> [--project-id <uuid>]
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
  let projectId = "";

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--" && argv[i + 1]) root = resolve(argv[++i]);
    else if (arg === "--root" && argv[i + 1]) root = resolve(argv[++i]);
    else if (arg === "--project-id" && argv[i + 1]) projectId = argv[++i];
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: pnpm klm:import-docs -- --root <repo> [--project-id <uuid>]`);
      process.exit(0);
    } else if (arg !== "--" && !arg.startsWith("-")) {
      root = resolve(arg);
    }
  }

  return { root, projectId: projectId || undefined };
}

loadEnv();

const { root, projectId: explicitProjectId } = parseArgs(process.argv.slice(2));

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("Error: DATABASE_URL required");
  process.exit(1);
}

const resolverDist = join(klmRoot, "packages", "project-resolver", "dist", "index.js");
if (!existsSync(resolverDist)) {
  console.error("Run pnpm --filter @klm/project-resolver build first");
  process.exit(1);
}

const { resolveProjectIdForRoot, ProjectNotInitializedError } = await import(
  pathToFileURL(resolverDist).href
);

let projectId;
try {
  projectId = await resolveProjectIdForRoot(root, explicitProjectId);
} catch (err) {
  if (err instanceof ProjectNotInitializedError) {
    console.error(`Error: ${err.code} — ${err.message}`);
    process.exit(1);
  }
  throw err;
}

const invariantsPath = join(root, "docs", "ARCHITECTURE_INVARIANTS.md");
const decisionsPath = join(root, "docs", "DECISIONS.md");

if (!existsSync(invariantsPath) && !existsSync(decisionsPath)) {
  console.error(`No docs found under ${root}/docs/`);
  process.exit(1);
}

const { parseProjectDocsFromPaths, toDecisionNodes, toInvariantNodes } = await import(
  pathToFileURL(join(klmRoot, "packages", "memory-core", "dist", "docs-importer.js")).href
);
const { PostgreSQLStateStore } = await import(
  pathToFileURL(join(klmRoot, "packages", "state-store", "dist", "postgres-store.js")).href
);

const parsed = parseProjectDocsFromPaths({
  invariantsPath: existsSync(invariantsPath) ? invariantsPath : undefined,
  decisionsPath: existsSync(decisionsPath) ? decisionsPath : undefined,
});

console.log(`Parsed from ${root}:`);
console.log(`  decisions: ${parsed.decisions.length}`);
console.log(`  invariants: ${parsed.invariants.length}`);

const store = new PostgreSQLStateStore(connectionString);
const existing = await store.getProjectState(projectId);
if (!existing) {
  console.error(`Project ${projectId} not found in project_states — run klm:init first`);
  await store.close();
  process.exit(1);
}

const beforeD = existing.decisions.length;
const beforeI = existing.invariants.length;

await store.applyMemoryUpdate(projectId, {
  newDecisions: toDecisionNodes(projectId, parsed.decisions),
  newInvariants: toInvariantNodes(projectId, parsed.invariants),
});

const after = await store.getProjectState(projectId);
await store.close();

console.log(`\nImported into project ${projectId}:`);
console.log(`  decisions: ${beforeD} → ${after?.decisions.length ?? beforeD}`);
console.log(`  invariants: ${beforeI} → ${after?.invariants.length ?? beforeI}`);

const fe = after?.invariants.filter((i) => i.rule.includes("INV-FE")) ?? [];
console.log(`  frontend invariants (INV-FE*): ${fe.length}`);
if (fe.length) {
  for (const inv of fe.slice(0, 5)) {
    console.log(`    - ${inv.rule.slice(0, 90)}...`);
  }
}
