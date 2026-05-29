import { randomUUID } from "node:crypto";
import pg from "pg";
import type { AuditEntry, AuditLogger, ModelCallEntry } from "./types.js";

export class PostgresAuditLogger implements AuditLogger {
  private pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async log(entry: AuditEntry): Promise<void> {
    await this.pool.query(
      `INSERT INTO audit_logs (
        id, organization_id, workspace_id, project_id, user_id,
        request_id, action, resource, outcome, payload
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
      [
        randomUUID(),
        entry.organizationId,
        entry.workspaceId,
        entry.projectId,
        entry.userId,
        entry.requestId ?? null,
        entry.action,
        entry.resource ?? null,
        entry.outcome,
        JSON.stringify(entry.payload ?? {}),
      ]
    );
  }

  async logModelCall(entry: ModelCallEntry): Promise<void> {
    await this.pool.query(
      `INSERT INTO model_calls (
        id, request_id, project_id, provider, model, task_type,
        prompt_tokens, completion_tokens, total_tokens, latency_ms
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        randomUUID(),
        entry.requestId ?? null,
        entry.projectId ?? null,
        entry.provider,
        entry.model,
        entry.taskType,
        entry.promptTokens,
        entry.completionTokens,
        entry.totalTokens,
        entry.latencyMs ?? null,
      ]
    );
  }
}

export class ConsoleAuditLogger implements AuditLogger {
  async log(entry: AuditEntry): Promise<void> {
    if (process.env.KLM_AUDIT_CONSOLE !== "false") {
      console.info("[klm-audit]", JSON.stringify(entry));
    }
  }

  async logModelCall(entry: ModelCallEntry): Promise<void> {
    if (process.env.KLM_AUDIT_CONSOLE !== "false") {
      console.info("[klm-model-call]", JSON.stringify(entry));
    }
  }
}

export class CompositeAuditLogger implements AuditLogger {
  constructor(private loggers: AuditLogger[]) {}

  async log(entry: AuditEntry): Promise<void> {
    await Promise.all(this.loggers.map((l) => l.log(entry)));
  }

  async logModelCall(entry: ModelCallEntry): Promise<void> {
    await Promise.all(this.loggers.map((l) => l.logModelCall(entry)));
  }
}
