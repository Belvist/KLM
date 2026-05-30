import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { CodebaseIndexer } from "./indexer.js";

function loadRootEnv(): void {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const envPath = join(root, ".env");
  if (!existsSync(envPath)) return;

  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function parseArgs(argv: string[]): { root: string; projectId: string } {
  let root = ".";
  let projectId = "";

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--root" && argv[i + 1]) {
      root = argv[++i]!;
    } else if (arg === "--project-id" && argv[i + 1]) {
      projectId = argv[++i]!;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  if (!projectId) {
    console.error("Error: --project-id is required");
    printHelp();
    process.exit(1);
  }

  return { root: resolve(root), projectId };
}

function printHelp(): void {
  console.log(`Usage: pnpm index:codebase -- --root <path> --project-id <uuid>

Indexes TypeScript/JavaScript source files into PostgreSQL structured tables
(code_files, code_symbols, code_dependencies, code_routes) and optionally
memory_chunks when KLM_SEMANTIC_MEMORY=true.

Options:
  --root         Repository root (default: .)
  --project-id   Target project UUID (required)
`);
}

async function main(): Promise<void> {
  loadRootEnv();

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const { root, projectId } = parseArgs(process.argv.slice(2));
  const indexer = new CodebaseIndexer(connectionString);

  try {
    console.log(`Indexing codebase at ${root} for project ${projectId}...`);
    const result = await indexer.indexProject({
      root,
      projectId,
      connectionString,
    });

    console.log("Index complete:");
    console.log(`  files:        ${result.filesIndexed}`);
    console.log(`  symbols:      ${result.symbolsIndexed}`);
    console.log(`  dependencies: ${result.dependenciesIndexed}`);
    console.log(`  routes:       ${result.routesIndexed}`);
    console.log(`  semantic:     ${result.semanticChunksIndexed}`);
  } finally {
    await indexer.close();
  }
}

main().catch((err) => {
  console.error("Index failed:", err);
  process.exit(1);
});
