import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { resolveProjectContext, pinProjectId } from "../packages/bootstrap/src/project-context.js";

function loadRootEnv(): void {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const envPath = join(root, ".env");
  if (existsSync(envPath)) config({ path: envPath });
}

const args = process.argv.slice(2);
let workspaceRoot = process.cwd();
let projectId = process.env.KLM_PROJECT_ID ?? "";

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--project-id" && args[i + 1]) {
    projectId = args[++i]!;
  } else if (!arg.startsWith("-")) {
    workspaceRoot = arg;
  }
}

async function main(): Promise<void> {
  loadRootEnv();
  if (projectId) {
    const manifest = pinProjectId(workspaceRoot, projectId);
    console.log(`Pinned project ${manifest.projectId} → ${manifest.rootPath}`);
  }

  const ctx = await resolveProjectContext(workspaceRoot, {
    projectId: projectId || undefined,
    writeManifest: true,
    autoRegister: Boolean(process.env.DATABASE_URL),
  });

  console.log(JSON.stringify(ctx.manifest, null, 2));
  console.log(
    `index: files=${ctx.indexStats.files} routes=${ctx.indexStats.routes} symbols=${ctx.indexStats.symbols}`
  );
  if (!ctx.indexed) {
    console.warn("[warn] No codebase index yet — run pnpm index:codebase for this project");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
