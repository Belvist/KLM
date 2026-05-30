import { randomUUID } from "node:crypto";
import pg from "pg";
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

const { Pool } = pg;

export class PostgreSQLStateStore implements StateStore {
  private pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async getProjectState(projectId: string): Promise<ProjectState | null> {
    const res = await this.pool.query(`SELECT state FROM project_states WHERE id = $1`, [
      projectId,
    ]);
    if (!res.rows[0]) return null;
    return ProjectStateSchema.parse(res.rows[0].state);
  }

  async saveProjectState(state: ProjectState): Promise<void> {
    const parsed = ProjectStateSchema.parse({ ...state, updatedAt: new Date() });
    await this.pool.query(
      `INSERT INTO project_states (id, workspace_id, state, updated_at)
       VALUES ($1, $2, $3::jsonb, NOW())
       ON CONFLICT (id) DO UPDATE SET state = $3::jsonb, updated_at = NOW()`,
      [parsed.id, parsed.workspaceId, JSON.stringify(parsed)]
    );
  }

  async getUserState(userId: string): Promise<UserState | null> {
    const res = await this.pool.query(`SELECT state FROM user_states WHERE id = $1`, [userId]);
    if (!res.rows[0]) return null;
    return UserStateSchema.parse(res.rows[0].state);
  }

  async saveUserState(state: UserState): Promise<void> {
    const parsed = UserStateSchema.parse(state);
    await this.pool.query(
      `INSERT INTO user_states (id, state, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (id) DO UPDATE SET state = $2::jsonb, updated_at = NOW()`,
      [parsed.id, JSON.stringify(parsed)]
    );
  }

  async appendEvent(event: Event): Promise<void> {
    const parsed = EventSchema.parse(event);
    await this.pool.query(
      `INSERT INTO events (id, project_id, user_id, type, content, timestamp, source, importance, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [
        parsed.id,
        parsed.projectId,
        parsed.userId,
        parsed.type,
        parsed.content,
        parsed.timestamp.toISOString(),
        parsed.source,
        parsed.importance,
        parsed.metadata ? JSON.stringify(parsed.metadata) : null,
      ]
    );
  }

  async getEvents(projectId: string, limit = 100): Promise<Event[]> {
    const res = await this.pool.query(
      `SELECT id, project_id, user_id, type, content, timestamp, source, importance, metadata
       FROM events WHERE project_id = $1 ORDER BY timestamp DESC LIMIT $2`,
      [projectId, limit]
    );
    return res.rows.reverse().map((row) =>
      EventSchema.parse({
        id: row.id,
        projectId: row.project_id,
        userId: row.user_id,
        type: row.type,
        content: row.content,
        timestamp: row.timestamp,
        source: row.source,
        importance: row.importance,
        metadata: row.metadata ?? undefined,
      })
    );
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
