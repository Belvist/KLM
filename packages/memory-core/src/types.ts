import type {
  DecisionNode,
  Event,
  Invariant,
  MemoryUpdate,
  ProjectState,
  RiskNode,
  Situation,
} from "@klm/core";

export type MemoryType =
  | "decisions"
  | "invariants"
  | "risks"
  | "codebase"
  | "bugs"
  | "roadmap"
  | "temporal"
  | "semantic"
  | "causal"
  | "procedural"
  | "failure";

export interface ActivatedMemory {
  decisions: DecisionNode[];
  invariants: Invariant[];
  risks: RiskNode[];
  recentEvents: Event[];
  principles: string[];
  contextSummary: string;
}

export interface MemoryActivator {
  activate(
    situation: Situation,
    projectState: ProjectState,
    memoryTypes: MemoryType[]
  ): Promise<ActivatedMemory>;
}

export interface MemoryCompiler {
  compileEvents(events: Event[]): Promise<{
    episodes: string[];
    decisions: Partial<DecisionNode>[];
    invariants: Partial<Invariant>[];
  }>;
}

export interface MemoryUpdater {
  buildUpdate(params: {
    userInput: string;
    situation: Situation;
    output: string;
    projectState: ProjectState;
  }): Promise<MemoryUpdate>;
}
