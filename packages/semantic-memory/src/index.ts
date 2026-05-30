export type { EmbeddingService } from "./embedding.js";
export { OpenAIEmbeddingService, MockEmbeddingService } from "./embedding.js";
export type { MemoryChunkRecord, MemoryChunkType } from "./pgvector-index.js";
export { PgVectorMemoryIndex } from "./pgvector-index.js";
export { SemanticMemoryIndexer } from "./indexer.js";
export { HybridMemoryActivator } from "./hybrid-activator.js";

import {
  OpenAIEmbeddingService,
  MockEmbeddingService,
  type EmbeddingService,
} from "./embedding.js";
import { PgVectorMemoryIndex } from "./pgvector-index.js";
import { HybridMemoryActivator } from "./hybrid-activator.js";
import { SemanticMemoryIndexer } from "./indexer.js";

export type EmbeddingProvider = "openai" | "mock";

export function createSemanticStack(
  connectionString: string,
  provider: EmbeddingProvider = resolveEmbeddingProvider()
) {
  const embeddings: EmbeddingService =
    provider === "mock" ? new MockEmbeddingService() : new OpenAIEmbeddingService();
  const index = new PgVectorMemoryIndex(connectionString);
  const activator = new HybridMemoryActivator(index, embeddings);
  const indexer = new SemanticMemoryIndexer(index, embeddings);
  return { embeddings, index, activator, indexer };
}

export function resolveEmbeddingProvider(): EmbeddingProvider {
  return process.env.KLM_EMBEDDING_PROVIDER === "mock" ? "mock" : "openai";
}

export function isSemanticMemoryEnabled(databaseUrl?: string): boolean {
  if (process.env.KLM_SEMANTIC_MEMORY !== "true" || !databaseUrl) return false;
  if (resolveEmbeddingProvider() === "mock") return true;
  return Boolean(process.env.OPENAI_API_KEY);
}
