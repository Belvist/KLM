import type { DecisionNode, Invariant, MemoryUpdate, ProjectState } from "@klm/core";
import { DecisionNodeSchema, InvariantSchema } from "@klm/core";

function decisionExists(state: ProjectState, decisionText: string): boolean {
  const normalized = decisionText.toLowerCase().trim();
  return state.decisions.some(
    (d) => d.status === "active" && d.decision.toLowerCase().trim() === normalized
  );
}

function invariantExists(state: ProjectState, ruleText: string): boolean {
  const normalized = ruleText.toLowerCase().trim();
  return state.invariants.some((i) => i.rule.toLowerCase().trim() === normalized);
}

function invariantIdFromRule(rule: string): string | null {
  const match = rule.match(/^\[(INV-[A-Z0-9-]+)\]/);
  return match?.[1] ?? null;
}

function invariantExistsById(state: ProjectState, invariantId: string): boolean {
  const needle = `[${invariantId}]`.toLowerCase();
  return state.invariants.some((i) => i.rule.toLowerCase().startsWith(needle));
}

export function mergeMemoryUpdate(state: ProjectState, update: MemoryUpdate): ProjectState {
  let next = state;

  const decisions: DecisionNode[] = [
    ...(update.newDecisions ?? []),
    ...(update.newDecision ? [update.newDecision] : []),
  ];
  for (const raw of decisions) {
    const parsed = DecisionNodeSchema.parse(raw);
    if (!decisionExists(next, parsed.decision)) {
      next = { ...next, decisions: [...next.decisions, parsed] };
    }
  }

  const invariants: Invariant[] = [
    ...(update.newInvariants ?? []),
    ...(update.newInvariant ? [update.newInvariant] : []),
  ];
  for (const raw of invariants) {
    const parsed = InvariantSchema.parse(raw);
    const id = invariantIdFromRule(parsed.rule);
    const exists = id
      ? invariantExistsById(next, id) || invariantExists(next, parsed.rule)
      : invariantExists(next, parsed.rule);
    if (!exists) {
      next = { ...next, invariants: [...next.invariants, parsed] };
    }
  }

  if (update.updatedRisk) {
    const idx = next.risks.findIndex((r) => r.id === update.updatedRisk!.id);
    if (idx >= 0) {
      const risks = [...next.risks];
      risks[idx] = update.updatedRisk;
      next = { ...next, risks };
    } else {
      next = { ...next, risks: [...next.risks, update.updatedRisk] };
    }
  }

  return next;
}
