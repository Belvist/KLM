import { createAuditLogger, type AuditLogger } from "@klm/audit";
import { ModelRouter } from "@klm/model-adapters";
import { KlmRuntime } from "@klm/runtime";
import { createSemanticStack, isSemanticMemoryEnabled } from "@klm/semantic-memory";
import { createStateStore, resetSharedStoreForTests, type StateStore } from "@klm/state-store";

export { extractTenant, getKlmEnvironment, TenantValidationError } from "./tenant.js";
export type { KlmEnvironment } from "./tenant.js";

export interface KlmApp {
  store: StateStore;
  router: ModelRouter;
  runtime: KlmRuntime;
  audit: AuditLogger;
}

let appInstance: KlmApp | null = null;

export interface CreateKlmAppOptions {
  /** Reset singleton — use in evals to simulate a fresh process. */
  reset?: boolean;
  /** Inject router (e.g. mock adapter for e2e evals). */
  router?: ModelRouter;
}

export async function createKlmApp(options: CreateKlmAppOptions = {}): Promise<KlmApp> {
  if (options.reset) {
    appInstance = null;
    resetSharedStoreForTests();
  }

  if (appInstance) return appInstance;

  const store = await createStateStore();
  const audit = createAuditLogger(process.env.DATABASE_URL);
  const router = options.router ?? new ModelRouter({ audit });

  const databaseUrl = process.env.DATABASE_URL;
  const semanticEnabled = isSemanticMemoryEnabled(databaseUrl);

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
  resetSharedStoreForTests();
}
