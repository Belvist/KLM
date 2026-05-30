export const SEARCH_KINDS = ["all", "files", "routes", "symbols", "dependencies"] as const;

export type SearchKind = (typeof SEARCH_KINDS)[number];

export class InvalidSearchKindError extends Error {
  constructor(kind: string) {
    super(`Invalid search kind: ${kind}. Allowed: ${SEARCH_KINDS.join(", ")}`);
    this.name = "InvalidSearchKindError";
  }
}

/** Strict allowlist — never pass arbitrary kind into SQL branches. */
export function parseSearchKind(raw?: string | null): SearchKind {
  const value = raw?.trim() ?? "all";
  if ((SEARCH_KINDS as readonly string[]).includes(value)) {
    return value as SearchKind;
  }
  throw new InvalidSearchKindError(value);
}
