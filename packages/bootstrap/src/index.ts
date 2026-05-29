import { ModelRouter } from "@klm/model-adapters";
import { KlmRuntime } from "@klm/runtime";
import { createStateStore, type StateStore } from "@klm/state-store";

export { extractTenant, getKlmEnvironment, TenantValidationError } from "./tenant.js";
export type { KlmEnvironment } from "./tenant.js";

export interface KlmApp {
  store: StateStore;
  router: ModelRouter;
  runtime: KlmRuntime;
}

let appInstance: KlmApp | null = null;

export async function createKlmApp(): Promise<KlmApp> {
  if (appInstance) return appInstance;

  const store = await createStateStore();
  const router = new ModelRouter();
  const runtime = new KlmRuntime({ store, router });

  appInstance = { store, router, runtime };
  return appInstance;
}

export function resetKlmAppForTests(): void {
  appInstance = null;
}
