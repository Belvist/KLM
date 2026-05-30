import pg from "pg";
import {
  exposeTextContent,
  type ContentExposureOptions,
  type ExposedTextContent,
} from "./content-exposure.js";

export interface PaginationParams {
  projectId: string;
  limit: number;
  cursor?: string;
  contentExposure?: ContentExposureOptions;
}

export interface PaginatedResult<T> {
  items: T[];
  nextCursor?: string;
}

export interface EventRow extends ExposedTextContent {
  id: string;
  projectId: string;
  userId: string;
  type: string;
  timestamp: string;
  source: string;
  importance: number;
}

export interface ModelCallRow {
  id: string;
  requestId?: string;
  projectId?: string;
  provider: string;
  model: string;
  taskType: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs?: number;
  createdAt: string;
}

export interface AuditLogRow {
  id: string;
  organizationId: string;
  workspaceId: string;
  projectId: string;
  userId: string;
  requestId?: string;
  action: string;
  resource?: string;
  outcome: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface MemoryChunkRow extends ExposedTextContent {
  id: string;
  projectId: string;
  chunkType: string;
  sourceId?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

export function parseLimit(raw?: string): number {
  const n = raw ? Number.parseInt(raw, 10) : DEFAULT_LIMIT;
  if (!Number.isFinite(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

function redactValue(key: string, value: unknown): unknown {
  if (/key|secret|token|password|authorization|apikey/i.test(key)) {
    return "[redacted]";
  }
  if (Array.isArray(value)) {
    return value.map((item) =>
      item && typeof item === "object" && !Array.isArray(item)
        ? redactPayload(item as Record<string, unknown>)
        : item
    );
  }
  if (value && typeof value === "object") {
    return redactPayload(value as Record<string, unknown>);
  }
  return value;
}

export function redactPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    out[k] = redactValue(k, v);
  }
  return out;
}

export class ObservabilityReader {
  private pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async listEvents(params: PaginationParams): Promise<PaginatedResult<EventRow>> {
    const exposure = params.contentExposure ?? {
      includeContent: false,
      forceRedactContent: false,
    };
    const values: unknown[] = [params.projectId, params.limit + 1];
    let query = `
      SELECT id, project_id, user_id, type, content, timestamp, source, importance
      FROM events
      WHERE project_id = $1
    `;
    if (params.cursor) {
      query += ` AND timestamp < $3::timestamptz`;
      values.push(params.cursor);
    }
    query += ` ORDER BY timestamp DESC LIMIT $2`;

    const res = await this.pool.query(query, values);
    const mapped = res.rows.map((row) => {
      const rawContent = String(row.content);
      return {
        id: String(row.id),
        projectId: String(row.project_id),
        userId: String(row.user_id),
        type: String(row.type),
        ...exposeTextContent(rawContent, exposure),
        timestamp: new Date(row.timestamp as string | Date).toISOString(),
        source: String(row.source),
        importance: Number(row.importance),
      };
    });
    return paginateRows(mapped, params.limit, (item) => item.timestamp);
  }

  async listModelCalls(params: PaginationParams): Promise<PaginatedResult<ModelCallRow>> {
    const values: unknown[] = [params.projectId, params.limit + 1];
    let query = `
      SELECT id, request_id, project_id, provider, model, task_type,
             prompt_tokens, completion_tokens, total_tokens, latency_ms, created_at
      FROM model_calls
      WHERE project_id = $1
    `;
    if (params.cursor) {
      query += ` AND created_at < $3::timestamptz`;
      values.push(params.cursor);
    }
    query += ` ORDER BY created_at DESC LIMIT $2`;

    const res = await this.pool.query(query, values);
    const mapped = res.rows.map((row) => ({
      id: String(row.id),
      requestId: row.request_id ? String(row.request_id) : undefined,
      projectId: row.project_id ? String(row.project_id) : undefined,
      provider: String(row.provider),
      model: String(row.model),
      taskType: String(row.task_type),
      promptTokens: Number(row.prompt_tokens),
      completionTokens: Number(row.completion_tokens),
      totalTokens: Number(row.total_tokens),
      latencyMs: row.latency_ms != null ? Number(row.latency_ms) : undefined,
      createdAt: new Date(row.created_at as string | Date).toISOString(),
    }));
    return paginateRows(mapped, params.limit, (item) => item.createdAt);
  }

  async listAuditLogs(params: PaginationParams): Promise<PaginatedResult<AuditLogRow>> {
    const values: unknown[] = [params.projectId, params.limit + 1];
    let query = `
      SELECT id, organization_id, workspace_id, project_id, user_id, request_id,
             action, resource, outcome, payload, created_at
      FROM audit_logs
      WHERE project_id = $1
    `;
    if (params.cursor) {
      query += ` AND created_at < $3::timestamptz`;
      values.push(params.cursor);
    }
    query += ` ORDER BY created_at DESC LIMIT $2`;

    const res = await this.pool.query(query, values);
    const mapped = res.rows.map((row) => ({
      id: String(row.id),
      organizationId: String(row.organization_id),
      workspaceId: String(row.workspace_id),
      projectId: String(row.project_id),
      userId: String(row.user_id),
      requestId: row.request_id ? String(row.request_id) : undefined,
      action: String(row.action),
      resource: row.resource ? String(row.resource) : undefined,
      outcome: String(row.outcome),
      payload: redactPayload((row.payload as Record<string, unknown>) ?? {}),
      createdAt: new Date(row.created_at as string | Date).toISOString(),
    }));
    return paginateRows(mapped, params.limit, (item) => item.createdAt);
  }

  async listMemoryChunks(
    params: PaginationParams & { chunkType?: string }
  ): Promise<PaginatedResult<MemoryChunkRow>> {
    const exposure = params.contentExposure ?? {
      includeContent: false,
      forceRedactContent: false,
    };
    const values: unknown[] = [params.projectId, params.limit + 1];
    let query = `
      SELECT id, project_id, chunk_type, source_id, content, metadata, created_at
      FROM memory_chunks
      WHERE project_id = $1
    `;
    let paramIdx = 3;
    if (params.chunkType) {
      query += ` AND chunk_type = $${paramIdx}`;
      values.push(params.chunkType);
      paramIdx++;
    }
    if (params.cursor) {
      query += ` AND created_at < $${paramIdx}::timestamptz`;
      values.push(params.cursor);
    }
    query += ` ORDER BY created_at DESC LIMIT $2`;

    const res = await this.pool.query(query, values);
    const mapped = res.rows.map((row) => {
      const rawContent = String(row.content);
      return {
        id: String(row.id),
        projectId: String(row.project_id),
        chunkType: String(row.chunk_type),
        sourceId: row.source_id ? String(row.source_id) : undefined,
        ...exposeTextContent(rawContent, exposure),
        metadata: redactPayload((row.metadata as Record<string, unknown>) ?? {}),
        createdAt: new Date(row.created_at as string | Date).toISOString(),
      };
    });
    return paginateRows(mapped, params.limit, (item) => item.createdAt);
  }
}

function paginateRows<T>(
  rows: T[],
  limit: number,
  cursorOf: (item: T) => string
): PaginatedResult<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  const nextCursor = hasMore && last ? cursorOf(last) : undefined;
  return { items, nextCursor };
}
