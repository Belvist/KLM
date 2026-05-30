import type { Event, ProjectState, Situation } from "@klm/core";
import type { ActivatedMemory, MemoryActivator, MemoryType } from "@klm/memory-core";
import {
  buildCodebaseActivationReport,
  MAX_ACTIVATION_SEARCH_TERMS,
  MAX_ACTIVATION_TERM_LENGTH,
} from "./codebase-activation-report.js";
import type { CodebaseSearchResult } from "./query-reader.js";
import {
  CodebaseQueryReader,
  DEFAULT_QUERY_LIMIT,
  MAX_QUERY_LIMIT,
  parseQueryLimit,
} from "./query-reader.js";

export {
  MAX_QUERY_LIMIT as MAX_ACTIVATION_BLOCK_ITEMS,
  DEFAULT_QUERY_LIMIT as DEFAULT_ACTIVATION_LIMIT,
};

export function isCodebaseActivationEnabled(databaseUrl?: string): boolean {
  return process.env.KLM_CODEBASE_ACTIVATION === "true" && Boolean(databaseUrl);
}

/** Env limit: default 50, min 1 → default, max 100. Invalid values fall back to default. */
export function resolveCodebaseActivationLimit(): number {
  const raw = process.env.KLM_CODEBASE_ACTIVATION_LIMIT;
  return parseQueryLimit(raw);
}

export function countActivationBlockItems(result: CodebaseSearchResult): number {
  return (
    result.routes.length + result.symbols.length + result.files.length + result.dependencies.length
  );
}

/** Cap merged search hits so activation cannot blow up the compile prompt. */
export function trimActivationSearchResult(
  result: CodebaseSearchResult,
  maxItems: number
): CodebaseSearchResult {
  if (maxItems < 1 || countActivationBlockItems(result) <= maxItems) {
    return result;
  }

  let remaining = maxItems;
  const take = <T>(items: T[]): T[] => {
    if (remaining <= 0) return [];
    const slice = items.slice(0, remaining);
    remaining -= slice.length;
    return slice;
  };

  return {
    ...result,
    routes: take(result.routes),
    symbols: take(result.symbols),
    files: take(result.files),
    dependencies: take(result.dependencies),
  };
}

const CODEBASE_SEARCH_STOPWORDS = new Set([
  "about",
  "after",
  "also",
  "and",
  "api",
  "are",
  "codebase",
  "defined",
  "does",
  "find",
  "from",
  "get",
  "has",
  "have",
  "how",
  "into",
  "is",
  "its",
  "like",
  "not",
  "our",
  "post",
  "put",
  "route",
  "routes",
  "that",
  "the",
  "this",
  "was",
  "what",
  "when",
  "where",
  "which",
  "with",
  "your",
]);

/** Extract short search terms from user intent (paths, identifiers) — not full sentences. */
export function extractCodebaseSearchTerms(situation: Situation): string[] {
  const text = [situation.intent.rawInput, ...situation.recentContext.slice(-4)]
    .join(" ")
    .trim()
    .slice(0, 500);

  if (!text) {
    return [];
  }

  const terms: string[] = [];
  const seen = new Set<string>();

  const add = (raw: string): void => {
    const term = raw.trim();
    if (!term || term.length > MAX_ACTIVATION_TERM_LENGTH) {
      return;
    }
    const key = term.toLowerCase();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    terms.push(term);
  };

  for (const match of text.matchAll(/\/[\w./\-{}:*]+/g)) {
    add(match[0]);
    const segment = match[0].split("/").filter(Boolean).pop();
    if (segment) {
      add(segment);
    }
  }

  for (const word of text.split(/\W+/)) {
    const lower = word.toLowerCase();
    if (word.length >= 3 && !CODEBASE_SEARCH_STOPWORDS.has(lower)) {
      add(word);
    }
  }

  return terms.slice(0, MAX_ACTIVATION_SEARCH_TERMS);
}

/** Primary search term for logging / legacy callers. */
export function buildCodebaseSearchQuery(situation: Situation): string {
  return extractCodebaseSearchTerms(situation)[0] ?? "";
}

function mergeSearchResults(
  target: CodebaseSearchResult,
  partial: CodebaseSearchResult
): CodebaseSearchResult {
  const fileIds = new Set(target.files.map((f) => f.id));
  const routeIds = new Set(target.routes.map((r) => r.id));
  const symbolIds = new Set(target.symbols.map((s) => s.id));
  const depIds = new Set(target.dependencies.map((d) => d.id));

  for (const file of partial.files) {
    if (!fileIds.has(file.id)) {
      fileIds.add(file.id);
      target.files.push(file);
    }
  }
  for (const route of partial.routes) {
    if (!routeIds.has(route.id)) {
      routeIds.add(route.id);
      target.routes.push(route);
    }
  }
  for (const symbol of partial.symbols) {
    if (!symbolIds.has(symbol.id)) {
      symbolIds.add(symbol.id);
      target.symbols.push(symbol);
    }
  }
  for (const dep of partial.dependencies) {
    if (!depIds.has(dep.id)) {
      depIds.add(dep.id);
      target.dependencies.push(dep);
    }
  }

  return target;
}

export function formatCodebaseActivationBlock(result: CodebaseSearchResult): string {
  const lines: string[] = ["Indexed codebase context (metadata only, no file contents):"];

  if (result.routes.length) {
    lines.push(
      "Routes:",
      ...result.routes.map(
        (r) =>
          `- ${r.httpMethod || "ANY"} ${r.path} (${r.filePath}${r.lineNumber ? `:${r.lineNumber}` : ""})`
      )
    );
  }

  if (result.symbols.length) {
    lines.push(
      "Symbols:",
      ...result.symbols.map(
        (s) =>
          `- ${s.symbolType} ${s.name}${s.exported ? " [exported]" : ""} (${s.filePath}${s.lineStart ? `:${s.lineStart}` : ""})`
      )
    );
  }

  if (result.files.length) {
    lines.push(
      "Files:",
      ...result.files.map(
        (f) =>
          `- ${f.relativePath}${f.language ? ` (${f.language})` : ""}${f.lineCount ? `, ${f.lineCount} lines` : ""}`
      )
    );
  }

  if (result.dependencies.length) {
    lines.push(
      "Dependencies:",
      ...result.dependencies.map((d) => `- ${d.sourceFilePath} → ${d.targetModule}`)
    );
  }

  if (lines.length === 1) {
    return "";
  }

  return lines.join("\n");
}

/**
 * Wraps an inner activator and appends structured codebase index hits to contextSummary.
 */
export class CodebaseMemoryActivator implements MemoryActivator {
  constructor(
    private inner: MemoryActivator,
    private reader: CodebaseQueryReader,
    private perKindLimit = resolveCodebaseActivationLimit()
  ) {}

  async activate(
    situation: Situation,
    projectState: ProjectState,
    memoryTypes: MemoryType[],
    recentEvents: Event[] = []
  ): Promise<ActivatedMemory> {
    const base = await this.inner.activate(situation, projectState, memoryTypes, recentEvents);

    if (!memoryTypes.includes("codebase")) {
      return base;
    }

    const terms = extractCodebaseSearchTerms(situation);
    if (!terms.length) {
      return {
        ...base,
        codebaseActivation: buildCodebaseActivationReport({ reason: "no_terms" }),
      };
    }

    try {
      const search: CodebaseSearchResult = {
        query: terms.join(" "),
        files: [],
        routes: [],
        symbols: [],
        dependencies: [],
      };

      for (const term of terms) {
        const partial = await this.reader.search({
          projectId: situation.projectId,
          query: term,
          kind: "all",
          limit: this.perKindLimit,
        });
        mergeSearchResults(search, partial);
      }

      const trimmed = trimActivationSearchResult(search, this.perKindLimit);
      const block = formatCodebaseActivationBlock(trimmed);
      if (!block) {
        return {
          ...base,
          codebaseActivation: buildCodebaseActivationReport({
            reason: "no_hits",
            searchTerms: terms,
            result: trimmed,
          }),
        };
      }

      return {
        ...base,
        contextSummary: [base.contextSummary, block].filter(Boolean).join("\n\n"),
        codebaseActivation: buildCodebaseActivationReport({
          reason: "activated",
          searchTerms: terms,
          result: trimmed,
          blockInjected: true,
        }),
      };
    } catch {
      return {
        ...base,
        codebaseActivation: buildCodebaseActivationReport({
          reason: "error",
          searchTerms: terms,
        }),
      };
    }
  }
}
