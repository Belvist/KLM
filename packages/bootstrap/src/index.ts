import { ModelRouter } from "@klm/model-adapters";
import { RuleBasedMemoryActivator, type MemoryActivator } from "@klm/memory-core";
import { KlmRuntime } from "@klm/runtime";
import {
  CodebaseMemoryActivator,
  CodebaseQueryReader,
  isCodebaseActivationEnabled,
} from "@klm/codebase-indexer";
import {
  createSemanticStack,
  HybridMemoryActivator,
  isSemanticMemoryEnabled,
} from "@klm/semantic-memory";
import { createAuditLogger, type AuditLogger } from "@klm/audit";
import { createStateStore, resetSharedStoreForTests, type StateStore } from "@klm/state-store";

export { extractTenant, getKlmEnvironment, TenantValidationError } from "./tenant.js";
export type { KlmEnvironment } from "./tenant.js";
export {
  projectIdFromPath,
  readManifest,
  writeManifest,
  resolveProjectContext,
  pinProjectId,
  newRequestId,
  manifestPath,
} from "./project-context.js";
export type { KlmProjectManifest, ResolvedProjectContext, ResolveProjectOptions } from "./project-context.js";

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

function buildMemoryActivator(databaseUrl: string | undefined): MemoryActivator {
  let activator: MemoryActivator = new RuleBasedMemoryActivator();

  if (isSemanticMemoryEnabled(databaseUrl) && databaseUrl) {
    const { index, embeddings } = createSemanticStack(databaseUrl);
    activator = new HybridMemoryActivator(index, embeddings);
  }

  if (isCodebaseActivationEnabled(databaseUrl) && databaseUrl) {
    const reader = new CodebaseQueryReader(databaseUrl);
    activator = new CodebaseMemoryActivator(activator, reader);
  }

  return activator;
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
  const memoryActivator = buildMemoryActivator(databaseUrl);

  let runtime: KlmRuntime;

  if (semanticEnabled && databaseUrl) {
    const { indexer } = createSemanticStack(databaseUrl);
    runtime = new KlmRuntime({
      store,
      router,
      audit,
      memoryActivator,
      semanticIndexer: indexer,
    });
  } else {
    runtime = new KlmRuntime({
      store,
      router,
      audit,
      memoryActivator,
    });
  }

  appInstance = { store, router, runtime, audit };
  return appInstance;
}

export function resetKlmAppForTests(): void {
  appInstance = null;
  resetSharedStoreForTests();
}
