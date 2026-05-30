import pg from "pg";
import type { SearchKind } from "./search-kind.js";
import { filterSafePaths, SAFE_CODE_FILE_PATH_SQL } from "./security-path.js";

export const MAX_QUERY_LIMIT = 100;
export const DEFAULT_QUERY_LIMIT = 50;

export function parseQueryLimit(raw?: string): number {
  const n = raw ? Number.parseInt(raw, 10) : DEFAULT_QUERY_LIMIT;
  if (!Number.isFinite(n) || n < 1) return DEFAULT_QUERY_LIMIT;
  return Math.min(n, MAX_QUERY_LIMIT);
}

export interface PaginatedResult<T> {
  items: T[];
  nextCursor?: string;
}

export interface CodeFileRow {
  id: string;
  relativePath: string;
  language?: string;
  lineCount: number;
  contentHash: string;
  indexedAt: string;
}

export interface CodeRouteRow {
  id: string;
  filePath: string;
  httpMethod: string;
  path: string;
  handlerName?: string;
  lineNumber?: number;
}

export interface CodeSymbolRow {
  id: string;
  filePath: string;
  symbolType: string;
  name: string;
  exported: boolean;
  lineStart?: number;
  lineEnd?: number;
}

export interface CodeDependencyRow {
  id: string;
  sourceFilePath: string;
  targetModule: string;
  importKind: string;
}

export interface CodebaseSearchResult {
  query: string;
  files: CodeFileRow[];
  routes: CodeRouteRow[];
  symbols: CodeSymbolRow[];
  dependencies: CodeDependencyRow[];
}

interface ListParams {
  projectId: string;
  limit: number;
  cursor?: string;
}

export class CodebaseQueryReader {
  private pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async listFiles(
    params: ListParams & { pathPrefix?: string; q?: string }
  ): Promise<PaginatedResult<CodeFileRow>> {
    const values: unknown[] = [params.projectId, params.limit + 1];
    let paramIdx = 3;

    let query = `
      SELECT cf.id, cf.relative_path, cf.language, cf.line_count, cf.content_hash, cf.indexed_at
      FROM code_files cf
      WHERE cf.project_id = $1
      ${SAFE_CODE_FILE_PATH_SQL}
    `;

    if (params.pathPrefix) {
      query += ` AND cf.relative_path LIKE $${paramIdx}`;
      values.push(`${params.pathPrefix}%`);
      paramIdx++;
    }

    if (params.q?.trim()) {
      query += ` AND (cf.relative_path ILIKE $${paramIdx} OR cf.language ILIKE $${paramIdx})`;
      values.push(`%${params.q.trim()}%`);
      paramIdx++;
    }

    if (params.cursor) {
      query += ` AND cf.relative_path > $${paramIdx}`;
      values.push(params.cursor);
      paramIdx++;
    }

    query += ` ORDER BY cf.relative_path ASC LIMIT $2`;

    const res = await this.pool.query(query, values);
    const mapped = res.rows.map((row) => mapFileRow(row));
    return paginateByCursor(mapped, params.limit, (item) => item.relativePath);
  }

  async listRoutes(
    params: ListParams & { path?: string; httpMethod?: string }
  ): Promise<PaginatedResult<CodeRouteRow>> {
    const values: unknown[] = [params.projectId, params.limit + 1];
    let paramIdx = 3;

    let query = `
      SELECT cr.id, cf.relative_path, cr.http_method, cr.path, cr.handler_name, cr.line_number
      FROM code_routes cr
      JOIN code_files cf ON cf.id = cr.file_id
      WHERE cr.project_id = $1
      ${SAFE_CODE_FILE_PATH_SQL}
    `;

    if (params.path?.trim()) {
      query += ` AND cr.path ILIKE $${paramIdx}`;
      values.push(`%${params.path.trim()}%`);
      paramIdx++;
    }

    if (params.httpMethod?.trim()) {
      query += ` AND cr.http_method = $${paramIdx}`;
      values.push(params.httpMethod.trim().toUpperCase());
      paramIdx++;
    }

    if (params.cursor) {
      query += ` AND cr.id > $${paramIdx}::uuid`;
      values.push(params.cursor);
      paramIdx++;
    }

    query += ` ORDER BY cr.id ASC LIMIT $2`;

    const res = await this.pool.query(query, values);
    const mapped = res.rows.map((row) => mapRouteRow(row));
    return paginateByCursor(mapped, params.limit, (item) => item.id);
  }

  async listSymbols(
    params: ListParams & { name?: string; symbolType?: string; exported?: boolean }
  ): Promise<PaginatedResult<CodeSymbolRow>> {
    const values: unknown[] = [params.projectId, params.limit + 1];
    let paramIdx = 3;

    let query = `
      SELECT cs.id, cf.relative_path, cs.symbol_type, cs.name, cs.exported, cs.line_start, cs.line_end
      FROM code_symbols cs
      JOIN code_files cf ON cf.id = cs.file_id
      WHERE cs.project_id = $1
      ${SAFE_CODE_FILE_PATH_SQL}
    `;

    if (params.name?.trim()) {
      query += ` AND cs.name ILIKE $${paramIdx}`;
      values.push(`%${params.name.trim()}%`);
      paramIdx++;
    }

    if (params.symbolType?.trim()) {
      query += ` AND cs.symbol_type = $${paramIdx}`;
      values.push(params.symbolType.trim());
      paramIdx++;
    }

    if (params.exported === true) {
      query += ` AND cs.exported = true`;
    } else if (params.exported === false) {
      query += ` AND cs.exported = false`;
    }

    if (params.cursor) {
      query += ` AND cs.id > $${paramIdx}::uuid`;
      values.push(params.cursor);
      paramIdx++;
    }

    query += ` ORDER BY cs.id ASC LIMIT $2`;

    const res = await this.pool.query(query, values);
    const mapped = res.rows.map((row) => mapSymbolRow(row));
    return paginateByCursor(mapped, params.limit, (item) => item.id);
  }

  async listDependencies(
    params: ListParams & { targetModule?: string; filePath?: string; q?: string }
  ): Promise<PaginatedResult<CodeDependencyRow>> {
    const values: unknown[] = [params.projectId, params.limit + 1];
    let paramIdx = 3;

    let query = `
      SELECT cd.id, cf.relative_path, cd.target_module, cd.import_kind
      FROM code_dependencies cd
      JOIN code_files cf ON cf.id = cd.source_file_id
      WHERE cd.project_id = $1
      ${SAFE_CODE_FILE_PATH_SQL}
    `;

    if (params.q?.trim()) {
      query += ` AND (cd.target_module ILIKE $${paramIdx} OR cf.relative_path ILIKE $${paramIdx})`;
      values.push(`%${params.q.trim()}%`);
      paramIdx++;
    } else {
      if (params.targetModule?.trim()) {
        query += ` AND cd.target_module ILIKE $${paramIdx}`;
        values.push(`%${params.targetModule.trim()}%`);
        paramIdx++;
      }

      if (params.filePath?.trim()) {
        query += ` AND cf.relative_path ILIKE $${paramIdx}`;
        values.push(`%${params.filePath.trim()}%`);
        paramIdx++;
      }
    }

    if (params.cursor) {
      query += ` AND cd.id > $${paramIdx}::uuid`;
      values.push(params.cursor);
      paramIdx++;
    }

    query += ` ORDER BY cd.id ASC LIMIT $2`;

    const res = await this.pool.query(query, values);
    const mapped = res.rows.map((row) => mapDependencyRow(row));
    return paginateByCursor(mapped, params.limit, (item) => item.id);
  }

  /**
   * Metadata-only search over structured index tables (code_files, code_routes, code_symbols,
   * code_dependencies). Never queries memory_chunks or file content.
   */
  async search(params: {
    projectId: string;
    query: string;
    limit?: number;
    kind?: SearchKind;
  }): Promise<CodebaseSearchResult> {
    const q = params.query.trim();
    const perKind = parseQueryLimit(params.limit != null ? String(params.limit) : undefined);
    const kind = params.kind ?? "all";

    const result: CodebaseSearchResult = {
      query: q,
      files: [],
      routes: [],
      symbols: [],
      dependencies: [],
    };

    if (!q) return result;

    if (kind === "all" || kind === "files") {
      const files = await this.listFiles({ projectId: params.projectId, limit: perKind, q });
      result.files = files.items;
    }

    if (kind === "all" || kind === "routes") {
      const routes = await this.listRoutes({
        projectId: params.projectId,
        limit: perKind,
        path: q,
      });
      result.routes = routes.items;
    }

    if (kind === "all" || kind === "symbols") {
      const symbols = await this.listSymbols({
        projectId: params.projectId,
        limit: perKind,
        name: q,
      });
      result.symbols = symbols.items;
    }

    if (kind === "all" || kind === "dependencies") {
      const deps = await this.listDependencies({
        projectId: params.projectId,
        limit: perKind,
        q,
      });
      result.dependencies = deps.items;
    }

    return result;
  }
}

export {
  parseSearchKind,
  SEARCH_KINDS,
  InvalidSearchKindError,
  type SearchKind,
} from "./search-kind.js";

function mapFileRow(row: pg.QueryResultRow): CodeFileRow {
  return {
    id: String(row.id),
    relativePath: String(row.relative_path),
    language: row.language ? String(row.language) : undefined,
    lineCount: Number(row.line_count),
    contentHash: String(row.content_hash),
    indexedAt: new Date(row.indexed_at as string | Date).toISOString(),
  };
}

function mapRouteRow(row: pg.QueryResultRow): CodeRouteRow {
  return {
    id: String(row.id),
    filePath: String(row.relative_path),
    httpMethod: String(row.http_method ?? ""),
    path: String(row.path),
    handlerName: row.handler_name ? String(row.handler_name) : undefined,
    lineNumber: row.line_number != null ? Number(row.line_number) : undefined,
  };
}

function mapSymbolRow(row: pg.QueryResultRow): CodeSymbolRow {
  return {
    id: String(row.id),
    filePath: String(row.relative_path),
    symbolType: String(row.symbol_type),
    name: String(row.name),
    exported: Boolean(row.exported),
    lineStart: row.line_start != null ? Number(row.line_start) : undefined,
    lineEnd: row.line_end != null ? Number(row.line_end) : undefined,
  };
}

function mapDependencyRow(row: pg.QueryResultRow): CodeDependencyRow {
  return {
    id: String(row.id),
    sourceFilePath: String(row.relative_path),
    targetModule: String(row.target_module),
    importKind: String(row.import_kind),
  };
}

function paginateByCursor<T>(
  rows: T[],
  limit: number,
  cursorOf: (item: T) => string
): PaginatedResult<T> {
  const safe = filterSafePaths(
    rows as Array<T & { relativePath?: string; filePath?: string }>
  ) as T[];
  const hasMore = safe.length > limit;
  const items = hasMore ? safe.slice(0, limit) : safe;
  const last = items[items.length - 1];
  const nextCursor = hasMore && last ? cursorOf(last) : undefined;
  return { items, nextCursor };
}
