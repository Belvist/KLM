import type { Event, ProjectState } from "@klm/core";
import type { EmbeddingService } from "./embedding.js";
import type { PgVectorMemoryIndex } from "./pgvector-index.js";

export class SemanticMemoryIndexer {
  constructor(
    private index: PgVectorMemoryIndex,
    private embeddings: EmbeddingService
  ) {}

  async indexProjectState(projectId: string, state: ProjectState): Promise<void> {
    const items: Array<{
      chunkType: import("./pgvector-index.js").MemoryChunkType;
      sourceId?: string;
      content: string;
      embedding: number[];
    }> = [];

    for (const d of state.decisions.filter((x) => x.status === "active")) {
      const content = `Decision: ${d.decision}. Reasons: ${d.reason.join("; ")}`;
      items.push({
        chunkType: "decision",
        sourceId: d.id,
        content,
        embedding: await this.embeddings.embed(content),
      });
    }

    for (const inv of state.invariants) {
      const content = `Invariant [${inv.severity}]: ${inv.rule}. ${inv.reason}`;
      items.push({
        chunkType: "invariant",
        sourceId: inv.id,
        content,
        embedding: await this.embeddings.embed(content),
      });
    }

    if (items.length) {
      await this.index.indexProjectContent({ projectId, items });
    }
  }

  async indexEvents(projectId: string, events: Event[]): Promise<void> {
    const recent = events.slice(-5);
    const items = [];

    for (const e of recent) {
      const content = `[${e.type}] ${e.content}`.slice(0, 2000);
      items.push({
        chunkType: "event" as const,
        sourceId: e.id,
        content,
        embedding: await this.embeddings.embed(content),
      });
    }

    if (items.length) {
      await this.index.indexProjectContent({ projectId, items });
    }
  }
}
