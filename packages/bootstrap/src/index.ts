import { createAuditLogger, type AuditLogger } from "@klm/audit";
import { ModelRouter } from "@klm/model-adapters";
import { KlmRuntime } from "@klm/runtime";
import { createSemanticStack } from "@klm/semantic-memory";
import { createStateStore, type StateStore } from "@klm/state-store";

export { extractTenant, getKlmEnvironment, TenantValidationError } from "./tenant.js";
export type { KlmEnvironment } from "./tenant.js";

export interface KlmApp {
  store: StateStore;
  router: ModelRouter;
  runtime: KlmRuntime;
  audit: AuditLogger;
}

let appInstance: KlmApp | null = null;

export async function createKlmApp(): Promise<KlmApp> {
  if (appInstance) return appInstance;

  const store = await createStateStore();
  const router = new ModelRouter();
  const audit = createAuditLogger(process.env.DATABASE_URL);

  const databaseUrl = process.env.DATABASE_URL;
  const semanticEnabled =
    process.env.KLM_SEMANTIC_MEMORY !== "false" && Boolean(databaseUrl);

  let runtime: KlmRuntime;

  if (semanticEnabled && databaseUrl) {
    const { activator, indexer } = createSemanticStack(databaseUrl);
    runtime = new KlmRuntime({
      store,
      router,
      audit,
      memoryActivator: activator,
      semanticIndexer: indexer,
    });
  } else {
    runtime = new KlmRuntime({ store, router, audit });
  }

  appInstance = { store, router, runtime, audit };
  return appInstance;
}

export function resetKlmAppForTests(): void {
  appInstance = null;
}
