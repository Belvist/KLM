import type { ProjectState, Situation } from "@klm/core";
import type { ActivatedMemory, MemoryActivator, MemoryType } from "./types.js";

export class RuleBasedMemoryActivator implements MemoryActivator {
  async activate(
    situation: Situation,
    projectState: ProjectState,
    memoryTypes: MemoryType[]
  ): Promise<ActivatedMemory> {
    const activeDecisions = memoryTypes.includes("decisions")
      ? projectState.decisions.filter((d) => d.status === "active")
      : [];

    const invariants = memoryTypes.includes("invariants")
      ? projectState.invariants
      : [];

    const risks = memoryTypes.includes("risks") ? projectState.risks : [];

    const relevantDecisions = this.filterByIntent(activeDecisions, situation.intent.rawInput);
    const relevantInvariants = this.filterByIntent(invariants, situation.intent.rawInput);

    const contextParts: string[] = [];

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
        "Invariants:\n" +
          relevantInvariants
            .map((i) => `- [${i.severity}] ${i.rule}`)
            .join("\n")
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
      recentEvents: [],
      principles: projectState.decisions
        .filter((d) => d.status === "active")
        .slice(0, 5)
        .map((d) => d.decision),
      contextSummary: contextParts.join("\n\n"),
    };
  }

  private filterByIntent<T extends { decision?: string; rule?: string }>(
    items: T[],
    input: string
  ): T[] {
    const tokens = input.toLowerCase().split(/\s+/).filter((t) => t.length > 3);
    if (!tokens.length) return items;

    return items.filter((item) => {
      const text = (item.decision ?? item.rule ?? "").toLowerCase();
      return tokens.some((t) => text.includes(t)) || items.length <= 10;
    }).slice(0, 10);
  }
}
