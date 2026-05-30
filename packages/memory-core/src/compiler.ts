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

  async compileEvents(
    events: Event[],
    scope?: { requestId?: string; projectId?: string }
  ): Promise<{
    episodes: string[];
    decisions: Array<Partial<import("@klm/core").DecisionNode>>;
    invariants: Array<Partial<import("@klm/core").Invariant>>;
  }> {
    if (!events.length) {
      return { episodes: [], decisions: [], invariants: [] };
    }

    const transcript = events.map((e) => `[${e.type}] ${e.content}`).join("\n");

    const response = await this.router.generate("memory_compression", {
      messages: [
        { role: "system", content: MEMORY_EXTRACTION_PROMPT },
        { role: "user", content: transcript },
      ],
      jsonMode: true,
      maxTokens: 2048,
      requestId: scope?.requestId,
      projectId: scope?.projectId,
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
  /**
   * User message is already saved in KlmRuntime.saveEvent().
   * Here we only persist the assistant response as a separate event.
   */
  async buildUpdate(params: {
    userInput: string;
    situation: Situation;
    output: string;
    projectState: ProjectState;
  }): Promise<MemoryUpdate> {
    if (!params.output.trim()) {
      return {};
    }

    return {
      newEvents: [
        {
          id: randomUUID(),
          projectId: params.situation.projectId,
          userId: params.situation.userId,
          type: "feedback",
          content: params.output,
          timestamp: new Date(),
          source: "system",
          importance: 0.6,
        },
      ],
    };
  }
}
