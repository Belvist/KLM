import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  DecisionNode,
  Event,
  Invariant,
  MemoryUpdate,
  ProjectState,
  UserState,
} from "@klm/core";
import {
  EventSchema,
  ProjectStateSchema,
  UserStateSchema,
} from "@klm/core";
import type { StateStore } from "./in-memory-store.js";
import { emptyProjectState } from "./in-memory-store.js";
import { mergeMemoryUpdate } from "./merge-memory-update.js";

interface PersistedState {
  projects: Record<string, ProjectState>;
  users: Record<string, UserState>;
  events: Record<string, Event[]>;
}

const EMPTY_STATE: PersistedState = { projects: {}, users: {}, events: {} };

/**
 * File-backed store for local dev.
 * Reads from disk on every operation (no cross-process memory cache).
 * Use PostgreSQL for API+MCP in production.
 */
export class FileStateStore implements StateStore {
  private writeLock: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  private async readFromDisk(): Promise<PersistedState> {
    try {
      const raw = await readFile(this.filePath, "utf-8");
      return JSON.parse(raw) as PersistedState;
    } catch {
      return structuredClone(EMPTY_STATE);
    }
  }

  private async withStore<T>(fn: (data: PersistedState) => Promise<T>): Promise<T> {
    const run = this.writeLock.then(async () => {
      const data = await this.readFromDisk();
      const result = await fn(data);
      await mkdir(dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.${randomUUID()}.tmp`;
      await writeFile(tmp, JSON.stringify(data, null, 2), "utf-8");
      await rename(tmp, this.filePath);
      return result;
    });
    this.writeLock = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  async getProjectState(projectId: string): Promise<ProjectState | null> {
    const data = await this.readFromDisk();
    const state = data.projects[projectId];
    return state ? ProjectStateSchema.parse(state) : null;
  }

  async saveProjectState(state: ProjectState): Promise<void> {
    const parsed = ProjectStateSchema.parse({ ...state, updatedAt: new Date() });
    await this.withStore(async (data) => {
      data.projects[parsed.id] = parsed;
    });
  }

  async getUserState(userId: string): Promise<UserState | null> {
    const data = await this.readFromDisk();
    const user = data.users[userId];
    return user ? UserStateSchema.parse(user) : null;
  }

  async saveUserState(state: UserState): Promise<void> {
    const parsed = UserStateSchema.parse(state);
    await this.withStore(async (data) => {
      data.users[parsed.id] = parsed;
    });
  }

  async appendEvent(event: Event): Promise<void> {
    const parsed = EventSchema.parse(event);
    await this.withStore(async (data) => {
      const list = data.events[parsed.projectId] ?? [];
      if (list.some((e) => e.id === parsed.id)) return;
      list.push(parsed);
      data.events[parsed.projectId] = list;
    });
  }

  async getEvents(projectId: string, limit = 100): Promise<Event[]> {
    const data = await this.readFromDisk();
    const list = data.events[projectId] ?? [];
    return list.slice(-limit).map((e) => EventSchema.parse(e));
  }

  async getDecisions(projectId: string): Promise<DecisionNode[]> {
    const state = await this.getProjectState(projectId);
    return state?.decisions ?? [];
  }

  async getInvariants(projectId: string): Promise<Invariant[]> {
    const state = await this.getProjectState(projectId);
    return state?.invariants ?? [];
  }

  async applyMemoryUpdate(projectId: string, update: MemoryUpdate): Promise<void> {
    await this.withStore(async (data) => {
      let state = data.projects[projectId]
        ? ProjectStateSchema.parse(data.projects[projectId])
        : emptyProjectState(projectId, randomUUID(), "Untitled Project");

      state = mergeMemoryUpdate(state, update);

      if (update.newEvents?.length) {
        const list = data.events[projectId] ?? [];
        for (const event of update.newEvents) {
          const parsed = EventSchema.parse(event);
          if (!list.some((e) => e.id === parsed.id)) {
            list.push(parsed);
          }
        }
        data.events[projectId] = list;
      }

      state.updatedAt = new Date();
      data.projects[projectId] = state;
    });
  }
}

export function defaultFileStorePath(): string {
  const base = process.env.KLM_STATE_PATH ?? join(process.cwd(), ".klm-data");
  return join(base, "state.json");
}
