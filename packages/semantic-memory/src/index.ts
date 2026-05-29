export type { EmbeddingService } from "./embedding.js";
export { OpenAIEmbeddingService } from "./embedding.js";
export type { MemoryChunkRecord, MemoryChunkType } from "./pgvector-index.js";
export { PgVectorMemoryIndex } from "./pgvector-index.js";
export { SemanticMemoryIndexer } from "./indexer.js";
export { HybridMemoryActivator } from "./hybrid-activator.js";

import { OpenAIEmbeddingService } from "./embedding.js";
import { PgVectorMemoryIndex } from "./pgvector-index.js";
import { HybridMemoryActivator } from "./hybrid-activator.js";
import { SemanticMemoryIndexer } from "./indexer.js";

export function createSemanticStack(connectionString: string) {
  const embeddings = new OpenAIEmbeddingService();
  const index = new PgVectorMemoryIndex(connectionString);
  const activator = new HybridMemoryActivator(index, embeddings);
  const indexer = new SemanticMemoryIndexer(index, embeddings);
  return { embeddings, index, activator, indexer };
}
