import { randomUUID } from "node:crypto";
import pg from "pg";

export type MemoryChunkType =
  | "decision"
  | "invariant"
  | "event"
  | "principle"
  | "risk"
  | "code_file"
  | "code_symbol"
  | "code_route";

export interface MemoryChunkRecord {
  id: string;
  projectId: string;
  chunkType: MemoryChunkType;
  sourceId?: string;
  content: string;
  score?: number;
}

export class PgVectorMemoryIndex {
  private pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  /**
   * Upsert by (project_id, chunk_type, source_id). Requires source_id for dedup.
   */
  async upsertChunk(params: {
    projectId: string;
    chunkType: MemoryChunkType;
    sourceId: string;
    content: string;
    embedding: number[];
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const id = randomUUID();
    const vectorLiteral = `[${params.embedding.join(",")}]`;

    await this.pool.query(
      `INSERT INTO memory_chunks (id, project_id, chunk_type, source_id, content, embedding, metadata)
       VALUES ($1, $2, $3, $4, $5, $6::vector, $7::jsonb)
       ON CONFLICT (project_id, chunk_type, source_id)
       DO UPDATE SET
         content = EXCLUDED.content,
         embedding = EXCLUDED.embedding,
         metadata = EXCLUDED.metadata`,
      [
        id,
        params.projectId,
        params.chunkType,
        params.sourceId,
        params.content,
        vectorLiteral,
        JSON.stringify(params.metadata ?? {}),
      ]
    );
  }

  async countChunks(projectId: string, sourceId?: string): Promise<number> {
    if (sourceId) {
      const res = await this.pool.query(
        `SELECT COUNT(*)::int AS c FROM memory_chunks WHERE project_id = $1 AND source_id = $2`,
        [projectId, sourceId]
      );
      return res.rows[0]?.c ?? 0;
    }
    const res = await this.pool.query(
      `SELECT COUNT(*)::int AS c FROM memory_chunks WHERE project_id = $1`,
      [projectId]
    );
    return res.rows[0]?.c ?? 0;
  }

  async search(params: {
    projectId: string;
    queryEmbedding: number[];
    limit?: number;
    chunkTypes?: MemoryChunkType[];
  }): Promise<MemoryChunkRecord[]> {
    const limit = params.limit ?? 8;
    const vectorLiteral = `[${params.queryEmbedding.join(",")}]`;

    let query = `
      SELECT id, project_id, chunk_type, source_id, content,
             1 - (embedding <=> $2::vector) AS score
      FROM memory_chunks
      WHERE project_id = $1 AND embedding IS NOT NULL
    `;
    const values: unknown[] = [params.projectId, vectorLiteral];

    if (params.chunkTypes?.length) {
      query += ` AND chunk_type = ANY($3)`;
      values.push(params.chunkTypes);
    }

    query += ` ORDER BY embedding <=> $2::vector LIMIT $${values.length + 1}`;
    values.push(limit);

    const res = await this.pool.query(query, values);

    return res.rows.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      chunkType: row.chunk_type,
      sourceId: row.source_id ?? undefined,
      content: row.content,
      score: Number(row.score),
    }));
  }

  async indexProjectContent(params: {
    projectId: string;
    items: Array<{
      chunkType: MemoryChunkType;
      sourceId: string;
      content: string;
      embedding: number[];
    }>;
  }): Promise<void> {
    for (const item of params.items) {
      if (!item.sourceId) {
        throw new Error("sourceId is required for memory chunk indexing");
      }
      await this.upsertChunk({
        projectId: params.projectId,
        ...item,
      });
    }
  }
}
