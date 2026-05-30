import pg from "pg";
import { ignoredDirPathMatchSql } from "./security-path.js";
import { sha256Content } from "./hash.js";
import { parseFile } from "./parser.js";
import { scanCodebase } from "./scanner.js";
import { indexSemanticChunks } from "./semantic.js";
import type { IndexOptions, IndexResult, ParsedSymbol } from "./types.js";

export class CodebaseIndexer {
  private pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async indexProject(options: IndexOptions): Promise<IndexResult> {
    const { root, projectId, connectionString } = options;
    const enableSemantic = options.enableSemantic ?? true;

    await this.assertProjectExists(projectId);

    const scanned = await scanCodebase(root);
    let symbolsIndexed = 0;
    let dependenciesIndexed = 0;
    let routesIndexed = 0;
    let semanticChunksIndexed = 0;

    for (const file of scanned) {
      const parsed = parseFile(file.content, file.relativePath);
      const contentHash = sha256Content(file.content);
      const fileId = await this.upsertFile({
        projectId,
        relativePath: file.relativePath,
        contentHash,
        language: parsed.language,
        lineCount: parsed.lineCount,
      });

      dependenciesIndexed += await this.replaceDependencies(projectId, fileId, parsed.imports);
      const symbolIds = await this.replaceSymbols(projectId, fileId, parsed.symbols);
      symbolsIndexed += symbolIds.length;

      const routeIds = await this.replaceRoutes(projectId, fileId, parsed.routes);
      routesIndexed += routeIds.length;

      if (enableSemantic) {
        semanticChunksIndexed += await indexSemanticChunks({
          projectId,
          connectionString,
          relativePath: file.relativePath,
          parsed,
        });
      }
    }

    return {
      filesIndexed: scanned.length,
      symbolsIndexed,
      dependenciesIndexed,
      routesIndexed,
      semanticChunksIndexed,
    };
  }

  private async assertProjectExists(projectId: string): Promise<void> {
    const res = await this.pool.query(`SELECT 1 FROM project_states WHERE id = $1`, [projectId]);
    if ((res.rowCount ?? 0) === 0) {
      throw new Error(`Project not found: ${projectId}. Run pnpm db:seed first.`);
    }
  }

  private async upsertFile(params: {
    projectId: string;
    relativePath: string;
    contentHash: string;
    language: string;
    lineCount: number;
  }): Promise<string> {
    const res = await this.pool.query<{ id: string }>(
      `INSERT INTO code_files (project_id, relative_path, content_hash, language, line_count, indexed_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (project_id, relative_path)
       DO UPDATE SET
         content_hash = EXCLUDED.content_hash,
         language = EXCLUDED.language,
         line_count = EXCLUDED.line_count,
         indexed_at = NOW()
       RETURNING id`,
      [params.projectId, params.relativePath, params.contentHash, params.language, params.lineCount]
    );
    const id = res.rows[0]?.id;
    if (!id) throw new Error(`Failed to upsert code file: ${params.relativePath}`);
    return id;
  }

  private async replaceDependencies(
    projectId: string,
    fileId: string,
    imports: Array<{ targetModule: string; importKind: string }>
  ): Promise<number> {
    await this.pool.query(
      `DELETE FROM code_dependencies WHERE project_id = $1 AND source_file_id = $2`,
      [projectId, fileId]
    );

    let count = 0;
    for (const imp of imports) {
      await this.pool.query(
        `INSERT INTO code_dependencies (project_id, source_file_id, target_module, import_kind)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (project_id, source_file_id, target_module, import_kind) DO NOTHING`,
        [projectId, fileId, imp.targetModule, imp.importKind]
      );
      count++;
    }
    return count;
  }

  private async replaceSymbols(
    projectId: string,
    fileId: string,
    symbols: ParsedSymbol[]
  ): Promise<Array<{ id: string; symbol: ParsedSymbol }>> {
    await this.pool.query(`DELETE FROM code_symbols WHERE project_id = $1 AND file_id = $2`, [
      projectId,
      fileId,
    ]);

    const result: Array<{ id: string; symbol: ParsedSymbol }> = [];

    for (const symbol of symbols) {
      const res = await this.pool.query<{ id: string }>(
        `INSERT INTO code_symbols (
           project_id, file_id, symbol_type, name, exported, line_start, line_end, signature
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (project_id, file_id, symbol_type, name, line_start)
         DO UPDATE SET
           exported = EXCLUDED.exported,
           line_end = EXCLUDED.line_end,
           signature = EXCLUDED.signature
         RETURNING id`,
        [
          projectId,
          fileId,
          symbol.symbolType,
          symbol.name,
          symbol.exported,
          symbol.lineStart ?? null,
          symbol.lineEnd ?? null,
          symbol.signature ?? null,
        ]
      );
      const id = res.rows[0]?.id;
      if (id) result.push({ id, symbol });
    }

    return result;
  }

  private async replaceRoutes(
    projectId: string,
    fileId: string,
    routes: Array<{
      httpMethod?: string;
      path: string;
      handlerName?: string;
      lineNumber?: number;
    }>
  ): Promise<Array<{ id: string; route: (typeof routes)[number] }>> {
    await this.pool.query(`DELETE FROM code_routes WHERE project_id = $1 AND file_id = $2`, [
      projectId,
      fileId,
    ]);

    const result: Array<{ id: string; route: (typeof routes)[number] }> = [];

    for (const route of routes) {
      const httpMethod = route.httpMethod ?? "";
      const res = await this.pool.query<{ id: string }>(
        `INSERT INTO code_routes (project_id, file_id, http_method, path, handler_name, line_number)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [
          projectId,
          fileId,
          httpMethod,
          route.path,
          route.handlerName ?? null,
          route.lineNumber ?? null,
        ]
      );

      const id = res.rows[0]?.id;
      if (id) result.push({ id, route });
    }

    return result;
  }
}

export async function countIndexedFiles(pool: pg.Pool, projectId: string): Promise<number> {
  const res = await pool.query<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM code_files WHERE project_id = $1`,
    [projectId]
  );
  return res.rows[0]?.c ?? 0;
}

export async function hasIgnoredPathIndexed(pool: pg.Pool, projectId: string): Promise<boolean> {
  const res = await pool.query<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM code_files
     WHERE project_id = $1 AND (
       ${ignoredDirPathMatchSql("relative_path")}
     )`,
    [projectId]
  );
  return (res.rows[0]?.c ?? 0) > 0;
}

export async function hasSecretPathIndexed(pool: pg.Pool, projectId: string): Promise<boolean> {
  const res = await pool.query<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM code_files
     WHERE project_id = $1 AND (
       relative_path ~ '(^|/)\\.env(\\.|$|/)'
       OR relative_path ~ '(^|/)\\.npmrc$'
       OR relative_path ~ '(^|/)\\.yarnrc$'
       OR relative_path ~ '(^|/)id_rsa$'
       OR relative_path ~ '(^|/)id_ed25519$'
       OR relative_path ~ '\\.pem$'
       OR relative_path ~ '\\.key$'
       OR relative_path ~ '\\.crt$'
       OR relative_path ~ '\\.p12$'
       OR relative_path ~ '\\.pfx$'
     )`,
    [projectId]
  );
  return (res.rows[0]?.c ?? 0) > 0;
}

export async function isCodeFileIndexed(
  pool: pg.Pool,
  projectId: string,
  relativePath: string
): Promise<boolean> {
  const res = await pool.query(
    `SELECT 1 FROM code_files WHERE project_id = $1 AND relative_path = $2 LIMIT 1`,
    [projectId, relativePath]
  );
  return (res.rowCount ?? 0) > 0;
}
