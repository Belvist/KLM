import { randomUUID } from "node:crypto";
import type { CandidateAction, Situation } from "@klm/core";
import type { ActivatedMemory } from "@klm/memory-core";

export function generateCandidateActions(
  situation: Situation,
  memory: ActivatedMemory
): CandidateAction[] {
  return [
    {
      id: randomUUID(),
      description: `Direct approach: ${situation.intent.rawInput}`,
      approach: "minimal implementation matching request",
      estimatedComplexity: "low",
      affectedModules: [],
    },
    {
      id: randomUUID(),
      description: `Production approach: ${situation.intent.rawInput}`,
      approach: `production-grade with auth, tests, observability; respects ${memory.invariants.length} invariants`,
      estimatedComplexity: "high",
      affectedModules: memory.decisions.flatMap((d) => d.linkedModules),
    },
    {
      id: randomUUID(),
      description: `Modular approach: ${situation.intent.rawInput}`,
      approach: "modular design with clear boundaries and migration path",
      estimatedComplexity: "medium",
      affectedModules: [],
    },
  ];
}
