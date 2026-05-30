import type { ProjectState } from "@klm/core";

export function normalizeMemoryText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

export function decisionAlreadyExists(projectState: ProjectState, decisionText: string): boolean {
  const normalized = normalizeMemoryText(decisionText);
  return projectState.decisions.some(
    (d) => d.status === "active" && normalizeMemoryText(d.decision) === normalized
  );
}

export function invariantAlreadyExists(projectState: ProjectState, ruleText: string): boolean {
  const normalized = normalizeMemoryText(ruleText);
  const idMatch = ruleText.match(/^\[(INV-[A-Z0-9-]+)\]/i);
  if (idMatch) {
    const needle = `[${idMatch[1]!.toUpperCase()}]`.toLowerCase();
    if (projectState.invariants.some((i) => i.rule.toLowerCase().startsWith(needle))) {
      return true;
    }
  }
  return projectState.invariants.some((i) => normalizeMemoryText(i.rule) === normalized);
}
