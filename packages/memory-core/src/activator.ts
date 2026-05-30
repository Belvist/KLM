import type { Event, ProjectState, Situation } from "@klm/core";
import type { ActivatedMemory, MemoryActivator, MemoryType } from "./types.js";

export class RuleBasedMemoryActivator implements MemoryActivator {
  async activate(
    situation: Situation,
    projectState: ProjectState,
    memoryTypes: MemoryType[],
    recentEvents: Event[] = []
  ): Promise<ActivatedMemory> {
    const activeDecisions = memoryTypes.includes("decisions")
      ? projectState.decisions.filter((d) => d.status === "active")
      : [];

    const invariants = memoryTypes.includes("invariants") ? projectState.invariants : [];

    const risks = memoryTypes.includes("risks") ? projectState.risks : [];

    const queryText = [situation.intent.rawInput, ...situation.recentContext].join(" ");

    const relevantDecisions = this.filterByRelevance(activeDecisions, queryText, "decision");
    const relevantInvariants = this.filterByRelevance(invariants, queryText, "rule");

    const contextParts: string[] = [];

    if (situation.recentContext.length) {
      contextParts.push("Recent conversation:\n" + situation.recentContext.slice(-12).join("\n"));
    }

    if (recentEvents.length) {
      contextParts.push(
        "Recent events:\n" +
          recentEvents
            .slice(-8)
            .map((e) => `- [${e.type}] ${e.content.slice(0, 200)}`)
            .join("\n")
      );
    }

    if (projectState.goals.length) {
      contextParts.push(`Goals: ${projectState.goals.join("; ")}`);
    }

    if (relevantDecisions.length) {
      contextParts.push(
        "Active decisions:\n" +
          relevantDecisions
            .map((d) => `- ${d.decision} (because: ${d.reason.join(", ")})`)
            .join("\n")
      );
    }

    if (relevantInvariants.length) {
      contextParts.push(
        "Invariants:\n" + relevantInvariants.map((i) => `- [${i.severity}] ${i.rule}`).join("\n")
      );
    }

    if (risks.length) {
      contextParts.push(
        "Risks:\n" +
          risks
            .filter((r) => r.status === "open")
            .map((r) => `- [${r.severity}] ${r.title}`)
            .join("\n")
      );
    }

    return {
      decisions: relevantDecisions,
      invariants: relevantInvariants,
      risks,
      recentEvents,
      principles: projectState.decisions
        .filter((d) => d.status === "active")
        .slice(0, 5)
        .map((d) => d.decision),
      contextSummary: contextParts.join("\n\n"),
    };
  }

  private filterByRelevance<T extends { decision?: string; rule?: string }>(
    items: T[],
    queryText: string,
    field: "decision" | "rule"
  ): T[] {
    const tokens = queryText
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 3);
    if (!tokens.length) return items.slice(0, 10);

    const scored = items.map((item) => {
      const text = (item[field] ?? "").toLowerCase();
      const matchCount = tokens.filter((t) => text.includes(t)).length;
      return { item, score: matchCount };
    });

    return scored
      .filter((s) => s.score > 0 || items.length <= 5)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map((s) => s.item);
  }
}
