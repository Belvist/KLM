import pg from "pg";
import {
  createSemanticStack,
  isSemanticMemoryEnabled,
  resolveEmbeddingProvider,
  type MemoryChunkType,
} from "@klm/semantic-memory";
import type { ParsedFile, ParsedRoute, ParsedSymbol } from "./types.js";

export interface SemanticIndexInput {
  projectId: string;
  connectionString: string;
  relativePath: string;
  parsed: ParsedFile;
}

export function stableFileSourceId(relativePath: string): string {
  return `code:file:${relativePath}`;
}

export function stableSymbolSourceId(relativePath: string, symbol: ParsedSymbol): string {
  return `code:symbol:${relativePath}:${symbol.symbolType}:${symbol.name}:${symbol.lineStart ?? 0}`;
}

export function stableRouteSourceId(relativePath: string, route: ParsedRoute): string {
  return `code:route:${relativePath}:${route.httpMethod ?? "ANY"}:${route.path}`;
}

export async function indexSemanticChunks(input: SemanticIndexInput): Promise<number> {
  if (!isSemanticMemoryEnabled(input.connectionString)) {
    return 0;
  }

  const { index, embeddings } = createSemanticStack(
    input.connectionString,
    resolveEmbeddingProvider()
  );
  let count = 0;

  try {
    const fileContent = buildFileChunkContent(input.relativePath, input.parsed);
    await index.upsertChunk({
      projectId: input.projectId,
      chunkType: "code_file" as MemoryChunkType,
      sourceId: stableFileSourceId(input.relativePath),
      content: fileContent,
      embedding: await embeddings.embed(fileContent),
      metadata: {
        relativePath: input.relativePath,
        language: input.parsed.language,
        lineCount: input.parsed.lineCount,
      },
    });
    count++;

    for (const symbol of input.parsed.symbols) {
      if (!symbol.exported) continue;
      const content = buildSymbolChunkContent(input.relativePath, symbol);
      await index.upsertChunk({
        projectId: input.projectId,
        chunkType: "code_symbol" as MemoryChunkType,
        sourceId: stableSymbolSourceId(input.relativePath, symbol),
        content,
        embedding: await embeddings.embed(content),
        metadata: {
          relativePath: input.relativePath,
          symbolType: symbol.symbolType,
          name: symbol.name,
          exported: symbol.exported,
        },
      });
      count++;
    }

    for (const route of input.parsed.routes) {
      const content = buildRouteChunkContent(input.relativePath, route);
      await index.upsertChunk({
        projectId: input.projectId,
        chunkType: "code_route" as MemoryChunkType,
        sourceId: stableRouteSourceId(input.relativePath, route),
        content,
        embedding: await embeddings.embed(content),
        metadata: {
          relativePath: input.relativePath,
          httpMethod: route.httpMethod,
          path: route.path,
        },
      });
      count++;
    }
  } finally {
    await index.close();
  }

  return count;
}

function buildFileChunkContent(relativePath: string, parsed: ParsedFile): string {
  const exported = parsed.symbols.filter((s) => s.exported).map((s) => s.name);
  const importCount = parsed.imports.length;
  const routeCount = parsed.routes.length;
  return [
    `Code file: ${relativePath}`,
    `Language: ${parsed.language}`,
    `Lines: ${parsed.lineCount}`,
    `Imports: ${importCount}`,
    `Routes: ${routeCount}`,
    exported.length > 0 ? `Exported symbols: ${exported.slice(0, 20).join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildSymbolChunkContent(relativePath: string, symbol: ParsedSymbol): string {
  return [
    `Exported ${symbol.symbolType}: ${symbol.name}`,
    `File: ${relativePath}`,
    symbol.lineStart ? `Line: ${symbol.lineStart}` : "",
    symbol.signature ? `Signature: ${symbol.signature}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildRouteChunkContent(relativePath: string, route: ParsedRoute): string {
  return [
    `HTTP route: ${route.httpMethod ?? "ANY"} ${route.path}`,
    `File: ${relativePath}`,
    route.lineNumber ? `Line: ${route.lineNumber}` : "",
    route.handlerName ? `Handler: ${route.handlerName}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function countSemanticCodeChunks(pool: pg.Pool, projectId: string): Promise<number> {
  const res = await pool.query<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM memory_chunks
     WHERE project_id = $1 AND chunk_type IN ('code_file', 'code_symbol', 'code_route')`,
    [projectId]
  );
  return res.rows[0]?.c ?? 0;
}
