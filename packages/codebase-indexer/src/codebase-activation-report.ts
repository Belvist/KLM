import type { CodebaseActivationReport, CodebaseActivationReason } from "@klm/core";
import { emptyCodebaseActivationCounts } from "@klm/core";
import type { CodebaseSearchResult } from "./query-reader.js";

const TERM_SECRET_PATTERNS: RegExp[] = [
  /sk-or-v1-[a-zA-Z0-9_-]+/gi,
  /sk-[a-zA-Z0-9_-]{8,}/gi,
  /(?:api[_-]?key|token|secret|password)\s*[:=]\s*\S+/gi,
];

export const MAX_ACTIVATION_SEARCH_TERMS = 10;
export const MAX_ACTIVATION_TERM_LENGTH = 80;

/** Sanitize extracted terms before audit/response — never log raw user secrets. */
export function sanitizeActivationSearchTerms(terms: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const raw of terms) {
    let term = raw.trim().slice(0, MAX_ACTIVATION_TERM_LENGTH);
    for (const pattern of TERM_SECRET_PATTERNS) {
      term = term.replace(pattern, "[redacted]");
    }
    if (!term || term === "[redacted]") {
      continue;
    }
    const key = term.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(term);
  }

  return out.slice(0, MAX_ACTIVATION_SEARCH_TERMS);
}

export function countsFromSearchResult(
  result: CodebaseSearchResult
): CodebaseActivationReport["counts"] {
  return {
    files: result.files.length,
    routes: result.routes.length,
    symbols: result.symbols.length,
    dependencies: result.dependencies.length,
  };
}

export function buildCodebaseActivationReport(params: {
  reason: CodebaseActivationReason;
  searchTerms?: string[];
  result?: CodebaseSearchResult;
  blockInjected?: boolean;
}): CodebaseActivationReport {
  const counts = params.result
    ? countsFromSearchResult(params.result)
    : emptyCodebaseActivationCounts();
  const itemTotal = counts.files + counts.routes + counts.symbols + counts.dependencies;
  const activationUsed = Boolean(params.blockInjected && itemTotal > 0);

  return {
    activationUsed,
    reason: params.reason,
    searchTerms: sanitizeActivationSearchTerms(params.searchTerms ?? []),
    counts,
  };
}
