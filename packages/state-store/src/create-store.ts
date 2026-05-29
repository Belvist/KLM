import type { StateStore } from "./in-memory-store.js";
import { InMemoryStateStore } from "./in-memory-store.js";
import { FileStateStore, defaultFileStorePath } from "./file-store.js";
import { PostgreSQLStateStore } from "./postgres-store.js";

export type StoreBackend = "memory" | "file" | "postgres";

export interface CreateStoreOptions {
  backend?: StoreBackend;
  databaseUrl?: string;
  filePath?: string;
}

let sharedStore: StateStore | null = null;

/**
 * Factory: one store instance per process.
 * API and MCP share memory when using `file` or `postgres` with the same path/URL.
 */
export async function createStateStore(options: CreateStoreOptions = {}): Promise<StateStore> {
  if (sharedStore) return sharedStore;

  const backend =
    options.backend ??
    (process.env.KLM_STORE_BACKEND as StoreBackend | undefined) ??
    (process.env.DATABASE_URL ? "postgres" : "file");

  switch (backend) {
    case "postgres": {
      const url = options.databaseUrl ?? process.env.DATABASE_URL;
      if (!url) {
        throw new Error("DATABASE_URL required for postgres store");
      }
      const store = new PostgreSQLStateStore(url);
      await store.init();
      sharedStore = store;
      break;
    }
    case "file": {
      sharedStore = new FileStateStore(options.filePath ?? defaultFileStorePath());
      break;
    }
    case "memory":
    default:
      sharedStore = new InMemoryStateStore();
      break;
  }

  return sharedStore;
}

export function resetSharedStoreForTests(): void {
  sharedStore = null;
}
