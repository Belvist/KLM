/** Invariants/decisions that belong to KLM Runtime seed — must not appear in external project profiles. */
export const KLM_PLATFORM_MEMORY_MARKERS = [
  "Model is replaceable",
  "PostgreSQL-first shared store for API and MCP",
  "Memory and state must persist",
  "Every model call must be audited",
  "API and MCP must share the same store",
  "KLM Runtime Live",
] as const;

export function findPlatformMemoryLeaks(state: {
  name?: string;
  invariants?: Array<{ rule: string }>;
  decisions?: Array<{ decision: string }>;
}): string[] {
  const leaks: string[] = [];
  const haystack = [
    state.name ?? "",
    ...(state.invariants ?? []).map((i) => i.rule),
    ...(state.decisions ?? []).map((d) => d.decision),
  ]
    .join("\n")
    .toLowerCase();

  for (const marker of KLM_PLATFORM_MEMORY_MARKERS) {
    if (haystack.includes(marker.toLowerCase())) {
      leaks.push(marker);
    }
  }
  return leaks;
}

export function hasEarflowMemory(state: {
  invariants?: Array<{ rule: string }>;
}): boolean {
  return (state.invariants ?? []).some((i) => /INV-FE-\d+/i.test(i.rule));
}
