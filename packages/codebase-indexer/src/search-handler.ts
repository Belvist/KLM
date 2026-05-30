import type { CodebaseSearchResult } from "./query-reader.js";
import { CodebaseQueryReader, parseQueryLimit } from "./query-reader.js";
import { InvalidSearchKindError, parseSearchKind } from "./search-kind.js";

export {
  InvalidSearchKindError,
  parseSearchKind,
  SEARCH_KINDS,
  type SearchKind,
} from "./search-kind.js";

export interface CodebaseSearchToolInput {
  query: string;
  kind?: string;
  limit?: number;
  /** Must not be used in Phase 2.5 — if present, must match tenantProjectId. */
  projectId?: string;
}

export type CodebaseSearchToolResult =
  | CodebaseSearchResult
  | { error: string; code: "FORBIDDEN" | "INVALID_KIND" | "NO_DATABASE" };

/**
 * MCP/API search handler. ProjectId always comes from tenant context, never from untrusted args alone.
 */
export async function handleCodebaseSearch(
  reader: CodebaseQueryReader | null,
  tenantProjectId: string,
  input: CodebaseSearchToolInput
): Promise<CodebaseSearchToolResult> {
  if (!reader) {
    return {
      error: "Codebase search requires DATABASE_URL and postgres backend",
      code: "NO_DATABASE",
    };
  }

  if (input.projectId && input.projectId !== tenantProjectId) {
    return {
      error: "Forbidden: project does not match configured tenant context",
      code: "FORBIDDEN",
    };
  }

  let kind;
  try {
    kind = parseSearchKind(input.kind);
  } catch (err) {
    if (err instanceof InvalidSearchKindError) {
      return { error: err.message, code: "INVALID_KIND" };
    }
    throw err;
  }

  const perKind = parseQueryLimit(input.limit != null ? String(input.limit) : undefined);

  return reader.search({
    projectId: tenantProjectId,
    query: input.query,
    kind,
    limit: perKind,
  });
}
