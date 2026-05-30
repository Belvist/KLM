import type { Event, ProjectState, Situation } from "@klm/core";
import type { ActivatedMemory, MemoryActivator, MemoryType } from "@klm/memory-core";
import { RuleBasedMemoryActivator } from "@klm/memory-core";
import type { EmbeddingService } from "./embedding.js";
import type { PgVectorMemoryIndex } from "./pgvector-index.js";

/**
 * Combines rule-based activation with pgvector semantic retrieval.
 */
export class HybridMemoryActivator implements MemoryActivator {
  private ruleBased = new RuleBasedMemoryActivator();

  constructor(
    private index: PgVectorMemoryIndex,
    private embeddings: EmbeddingService
  ) {}

  async activate(
    situation: Situation,
    projectState: ProjectState,
    memoryTypes: MemoryType[],
    recentEvents: Event[] = []
  ): Promise<ActivatedMemory> {
    const base = await this.ruleBased.activate(situation, projectState, memoryTypes, recentEvents);

    const queryText = [situation.intent.rawInput, ...situation.recentContext].join(" ");
    if (!queryText.trim()) {
      return base;
    }

    try {
      const queryEmbedding = await this.embeddings.embed(queryText);
      const semanticHits = await this.index.search({
        projectId: situation.projectId,
        queryEmbedding,
        limit: 6,
        chunkTypes: ["decision", "invariant", "principle"],
      });

      if (!semanticHits.length) {
        return base;
      }

      const semanticBlock =
        "Semantic memory (vector retrieval):\n" +
        semanticHits
          .map(
            (h) =>
              `- [${h.chunkType}] ${h.content.slice(0, 300)} (score ${(h.score ?? 0).toFixed(2)})`
          )
          .join("\n");

      return {
        ...base,
        contextSummary: [base.contextSummary, semanticBlock].filter(Boolean).join("\n\n"),
        principles: [
          ...new Set([
            ...base.principles,
            ...semanticHits.filter((h) => h.chunkType === "decision").map((h) => h.content),
          ]),
        ].slice(0, 8),
      };
    } catch {
      return base;
    }
  }
}
