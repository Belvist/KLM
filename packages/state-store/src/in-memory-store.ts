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

export interface StateStore {
  getProjectState(projectId: string): Promise<ProjectState | null>;
  saveProjectState(state: ProjectState): Promise<void>;
  getUserState(userId: string): Promise<UserState | null>;
  saveUserState(state: UserState): Promise<void>;
  appendEvent(event: Event): Promise<void>;
  getEvents(projectId: string, limit?: number): Promise<Event[]>;
  getDecisions(projectId: string): Promise<DecisionNode[]>;
  getInvariants(projectId: string): Promise<Invariant[]>;
  applyMemoryUpdate(projectId: string, update: MemoryUpdate): Promise<void>;
}

function emptyProjectState(projectId: string, workspaceId: string, name: string): ProjectState {
  return ProjectStateSchema.parse({
    id: projectId,
    workspaceId,
    name,
    description: "",
    goals: [],
    businessModel: [],
    architecture: { summary: "", components: [], dataFlows: [] },
    techStack: { languages: [], frameworks: [], databases: [], infra: [], tools: [] },
    invariants: [],
    decisions: [],
    risks: [],
    roadmap: [],
    codebaseMap: { rootPath: ".", fileCount: 0, modules: [] },
    updatedAt: new Date(),
  });
}

/**
 * In-memory store for Phase 0/1. Replace with PostgreSQL adapter in production.
 */
export class InMemoryStateStore implements StateStore {
  private projects = new Map<string, ProjectState>();
  private users = new Map<string, UserState>();
  private events = new Map<string, Event[]>();

  async getProjectState(projectId: string): Promise<ProjectState | null> {
    return this.projects.get(projectId) ?? null;
  }

  async saveProjectState(state: ProjectState): Promise<void> {
    const parsed = ProjectStateSchema.parse({ ...state, updatedAt: new Date() });
    this.projects.set(parsed.id, parsed);
  }

  async getUserState(userId: string): Promise<UserState | null> {
    return this.users.get(userId) ?? null;
  }

  async saveUserState(state: UserState): Promise<void> {
    this.users.set(state.id, UserStateSchema.parse(state));
  }

  async appendEvent(event: Event): Promise<void> {
    const parsed = EventSchema.parse(event);
    const list = this.events.get(parsed.projectId) ?? [];
    list.push(parsed);
    this.events.set(parsed.projectId, list);
  }

  async getEvents(projectId: string, limit = 100): Promise<Event[]> {
    const list = this.events.get(projectId) ?? [];
    return list.slice(-limit);
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
      const parsed = DecisionNodeSchema.parse(update.newDecision);
      const exists = state.decisions.some(
        (d) =>
          d.status === "active" &&
          d.decision.toLowerCase().trim() === parsed.decision.toLowerCase().trim()
      );
      if (!exists) {
        state.decisions = [...state.decisions, parsed];
      }
    }

    if (update.newInvariant) {
      const parsed = InvariantSchema.parse(update.newInvariant);
      const exists = state.invariants.some(
        (i) => i.rule.toLowerCase().trim() === parsed.rule.toLowerCase().trim()
      );
      if (!exists) {
        state.invariants = [...state.invariants, parsed];
      }
    }

    if (update.updatedRisk) {
      const idx = state.risks.findIndex((r) => r.id === update.updatedRisk!.id);
      if (idx >= 0) {
        state.risks[idx] = update.updatedRisk;
      } else {
        state.risks.push(update.updatedRisk);
      }
    }

    if (update.newEvents?.length) {
      for (const event of update.newEvents) {
        await this.appendEvent(event);
      }
    }

    await this.saveProjectState(state);
  }

  ensureProject(projectId: string, workspaceId: string, name: string): ProjectState {
    let state = this.projects.get(projectId);
    if (!state) {
      state = emptyProjectState(projectId, workspaceId, name);
      this.projects.set(projectId, state);
    }
    return state;
  }
}

export { emptyProjectState };
