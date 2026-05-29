import { randomUUID } from "node:crypto";
import type { Event, MemoryUpdate, ProjectState, Situation } from "@klm/core";
import type { ModelRouter } from "@klm/model-adapters";
import type { MemoryCompiler, MemoryUpdater } from "./types.js";

const MEMORY_EXTRACTION_PROMPT = `Analyze the interaction and extract structured memory updates.
Return JSON with optional fields:
- decision: { decision, reason[], rejectedAlternatives[], consequencesExpected[] }
- invariant: { rule, reason, severity: "soft"|"hard"|"critical", appliesTo[] }
- risk: { title, description, severity, linkedModules[] }
Only extract if there is a clear architectural or project decision. Return {} if nothing durable.`;

export class LlmMemoryCompiler implements MemoryCompiler {
  constructor(private router: ModelRouter) {}

  async compileEvents(events: Event[]): Promise<{
    episodes: string[];
    decisions: Array<Partial<import("@klm/core").DecisionNode>>;
    invariants: Array<Partial<import("@klm/core").Invariant>>;
  }> {
    if (!events.length) {
      return { episodes: [], decisions: [], invariants: [] };
    }

    const transcript = events
      .map((e) => `[${e.type}] ${e.content}`)
      .join("\n");

    const response = await this.router.generate("memory_compression", {
      messages: [
        { role: "system", content: MEMORY_EXTRACTION_PROMPT },
        { role: "user", content: transcript },
      ],
      jsonMode: true,
      maxTokens: 2048,
    });

    try {
      const parsed = JSON.parse(response.content) as {
        episodes?: string[];
        decisions?: Array<Partial<import("@klm/core").DecisionNode>>;
        invariants?: Array<Partial<import("@klm/core").Invariant>>;
      };
      return {
        episodes: parsed.episodes ?? [],
        decisions: parsed.decisions ?? [],
        invariants: parsed.invariants ?? [],
      };
    } catch {
      return { episodes: [transcript.slice(0, 500)], decisions: [], invariants: [] };
    }
  }
}

export class BasicMemoryUpdater implements MemoryUpdater {
  async buildUpdate(params: {
    userInput: string;
    situation: Situation;
    output: string;
    projectState: ProjectState;
  }): Promise<MemoryUpdate> {
    const now = new Date();
    return {
      newEvents: [
        {
          id: randomUUID(),
          projectId: params.situation.projectId,
          userId: params.situation.userId,
          type: "message",
          content: params.userInput,
          timestamp: now,
          source: "chat",
          importance: 0.5,
        },
      ],
    };
  }
}
