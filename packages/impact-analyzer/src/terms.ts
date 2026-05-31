const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "this",
  "that",
  "from",
  "into",
  "when",
  "where",
  "what",
  "how",
  "why",
  "will",
  "should",
  "need",
  "task",
  "change",
  "update",
  "fix",
  "add",
  "use",
  "using",
  "via",
  "not",
  "are",
  "was",
  "were",
  "has",
  "have",
]);

export const MAX_IMPACT_SEARCH_TERMS = 12;
export const MAX_TERM_LENGTH = 80;

/** Extract metadata search terms from a task description (paths, identifiers). */
export function extractImpactSearchTerms(task: string): string[] {
  const text = task.trim().slice(0, 500);
  if (!text) return [];

  const terms: string[] = [];
  const seen = new Set<string>();

  const add = (raw: string): void => {
    const term = raw.trim().slice(0, MAX_TERM_LENGTH);
    if (!term) return;
    const key = term.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    terms.push(term);
  };

  for (const match of text.matchAll(/\/[\w./\-{}:*]+/g)) {
    add(match[0]);
    const segment = match[0].split("/").filter(Boolean).pop();
    if (segment) add(segment);
  }

  for (const match of text.matchAll(/INV-[A-Z]{2}-\d{3}/gi)) {
    add(match[0].toUpperCase());
  }

  for (const word of text.split(/\W+/)) {
    const lower = word.toLowerCase();
    if (word.length >= 3 && !STOPWORDS.has(lower)) {
      add(word);
    }
  }

  return terms.slice(0, MAX_IMPACT_SEARCH_TERMS);
}

/** Score how many terms match a haystack string (0–1). */
export function matchScore(terms: string[], haystack: string): number {
  if (!terms.length || !haystack) return 0;
  const lower = haystack.toLowerCase();
  let hits = 0;
  for (const term of terms) {
    if (lower.includes(term.toLowerCase())) hits++;
  }
  return Math.min(1, hits / Math.max(1, Math.min(terms.length, 4)));
}
