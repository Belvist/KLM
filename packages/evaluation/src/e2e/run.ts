import pg from "pg";
import { runHttpApiE2e } from "./http-api-e2e.js";
import { runMcpSharedStoreE2e } from "./mcp-shared-store-e2e.js";
import { runStreamMemoryE2e } from "./stream-memory-e2e.js";
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
    await runStreamMemoryE2e(pool, results);
    await runMcpSharedStoreE2e(pool, results);
  } finally {
    await pool.end();
  }

  const failed = printResults(results, "KLM E2E Evaluation (Phase 2.2)");
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
