import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

/**
 * Cross-platform unit test runner.
 * Exits 0 when no *.test.ts files exist (CI-safe on Linux).
 */
function collectTestFiles(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectTestFiles(path, acc);
    } else if (entry.name.endsWith(".test.ts")) {
      acc.push(path);
    }
  }
  return acc;
}

const srcDir = join(process.cwd(), "src");
let files = [];

try {
  files = collectTestFiles(srcDir);
} catch {
  files = [];
}

if (files.length === 0) {
  process.exit(0);
}

const result = spawnSync(process.execPath, ["--import", "tsx", "--test", ...files], {
  stdio: "inherit",
});

process.exit(result.status ?? 1);
