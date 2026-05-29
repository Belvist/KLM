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
  DecisionNodeSchema,
  EventSchema,
  InvariantSchema,
  ProjectStateSchema,
  UserStateSchema,
} from "@klm/core";
import type { StateStore } from "./in-memory-store.js";
import { emptyProjectState } from "./in-memory-store.js";

interface PersistedState {
  projects: Record<string, ProjectState>;
  users: Record<string, UserState>;
  events: Record<string, Event[]>;
}

/**
 * File-backed store — shared between API and MCP processes via KLM_STATE_PATH.
 */
export class FileStateStore implements StateStore {
  private cache: PersistedState | null = null;
  private writeLock: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  private async load(): Promise<PersistedState> {
    if (this.cache) return this.cache;
    try {
      const raw = await readFile(this.filePath, "utf-8");
      this.cache = JSON.parse(raw) as PersistedState;
    } catch {
      this.cache = { projects: {}, users: {}, events: {} };
    }
    return this.cache;
  }

  private async persist(data: PersistedState): Promise<void> {
    this.cache = data;
    const run = this.writeLock.then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.${randomUUID()}.tmp`;
      await writeFile(tmp, JSON.stringify(data, null, 2), "utf-8");
      await rename(tmp, this.filePath);
    });
    this.writeLock = run.catch(() => {});
    await run;
  }

  async getProjectState(projectId: string): Promise<ProjectState | null> {
    const data = await this.load();
    const state = data.projects[projectId];
    return state ? ProjectStateSchema.parse(state) : null;
  }

  async saveProjectState(state: ProjectState): Promise<void> {
    const data = await this.load();
    const parsed = ProjectStateSchema.parse({ ...state, updatedAt: new Date() });
    data.projects[parsed.id] = parsed;
    await this.persist(data);
  }

  async getUserState(userId: string): Promise<UserState | null> {
    const data = await this.load();
    const user = data.users[userId];
    return user ? UserStateSchema.parse(user) : null;
  }

  async saveUserState(state: UserState): Promise<void> {
    const data = await this.load();
    data.users[state.id] = UserStateSchema.parse(state);
    await this.persist(data);
  }

  async appendEvent(event: Event): Promise<void> {
    const data = await this.load();
    const parsed = EventSchema.parse(event);
    const list = data.events[parsed.projectId] ?? [];
    list.push(parsed);
    data.events[parsed.projectId] = list;
    await this.persist(data);
  }

  async getEvents(projectId: string, limit = 100): Promise<Event[]> {
    const data = await this.load();
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
    let state = await this.getProjectState(projectId);
    if (!state) {
      state = emptyProjectState(projectId, randomUUID(), "Untitled Project");
    }

    if (update.newDecision) {
      state.decisions = [...state.decisions, DecisionNodeSchema.parse(update.newDecision)];
    }
    if (update.newInvariant) {
      state.invariants = [...state.invariants, InvariantSchema.parse(update.newInvariant)];
    }
    if (update.updatedRisk) {
      const idx = state.risks.findIndex((r) => r.id === update.updatedRisk!.id);
      if (idx >= 0) state.risks[idx] = update.updatedRisk;
      else state.risks.push(update.updatedRisk);
    }
    if (update.newEvents?.length) {
      for (const event of update.newEvents) {
        await this.appendEvent(event);
      }
    }

    await this.saveProjectState(state);
  }
}

export function defaultFileStorePath(): string {
  const base = process.env.KLM_STATE_PATH ?? join(process.cwd(), ".klm-data");
  return join(base, "state.json");
}
