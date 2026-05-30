import pg from "pg";
import { runCodebaseActivationE2e } from "./codebase-activation-e2e.js";
import { runCodebaseQueryE2e } from "./codebase-query-e2e.js";
import { runHttpApiE2e } from "./http-api-e2e.js";
import { runMcpSharedStoreE2e } from "./mcp-shared-store-e2e.js";
import { runModelCallOutcomeE2e } from "./model-call-outcome-e2e.js";
import { runObservabilityE2e } from "./observability-e2e.js";
import { runSemanticMemoryE2e } from "./semantic-memory-e2e.js";
import { runStreamMemoryE2e } from "./stream-memory-e2e.js";
import { runProjectResolverE2e } from "./project-resolver-e2e.js";
import type { EvalResult } from "./helpers.js";
import { printResults } from "./helpers.js";

async function main(): Promise<void> {
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    console.error("DATABASE_URL required for e2e evals");
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  const results: EvalResult[] = [];

  try {
    await runHttpApiE2e(pool, results);
    await runObservabilityE2e(pool, results);
    await runCodebaseQueryE2e(pool, results);
    await runCodebaseActivationE2e(pool, results);
    await runModelCallOutcomeE2e(pool, results);
    await runSemanticMemoryE2e(pool, results);
    await runStreamMemoryE2e(pool, results);
    await runMcpSharedStoreE2e(pool, results);
    await runProjectResolverE2e(pool, results);
  } finally {
    await pool.end();
  }

  const failed = printResults(results, "KLM E2E Evaluation (Phase 2.6.1)");
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
