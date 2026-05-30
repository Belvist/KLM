import { randomUUID } from "node:crypto";
import type { MemoryUpdate, ProjectState } from "@klm/core";
import { DecisionNodeSchema, InvariantSchema } from "@klm/core";
import type { ModelRouter } from "@klm/model-adapters";
import type { StateStore } from "@klm/state-store";
import { BasicMemoryUpdater, LlmMemoryCompiler } from "./compiler.js";
import { decisionAlreadyExists, invariantAlreadyExists } from "./dedup.js";
import { explicitToMemoryUpdate, parseExplicitMemory } from "./explicit-memory.js";

export interface MemoryPipelineConfig {
  store: StateStore;
  router?: ModelRouter;
  enableLlmCompiler?: boolean;
}

function extractLimit(): number {
  const raw = process.env.KLM_MEMORY_EXTRACT_LIMIT;
  const n = raw ? Number.parseInt(raw, 10) : 10;
  return Number.isFinite(n) && n > 0 ? Math.min(n, 50) : 10;
}

/**
 * event saved (user) → assistant event → compile → validate/dedup → persist
 */
export class MemoryPipeline {
  private basicUpdater: BasicMemoryUpdater;
  private llmCompiler?: LlmMemoryCompiler;

  constructor(private config: MemoryPipelineConfig) {
    this.basicUpdater = new BasicMemoryUpdater();
    if (config.router && config.enableLlmCompiler !== false) {
      this.llmCompiler = new LlmMemoryCompiler(config.router);
    }
  }

  async afterResponse(params: {
    userInput: string;
    output: string;
    projectId: string;
    userId: string;
    requestId?: string;
    projectState: ProjectState;
    situation: import("@klm/core").Situation;
  }): Promise<MemoryUpdate> {
    const baseUpdate = await this.basicUpdater.buildUpdate({
      userInput: params.userInput,
      situation: params.situation,
      output: params.output,
      projectState: params.projectState,
    });

    if (baseUpdate.newEvents?.length) {
      await this.config.store.applyMemoryUpdate(params.projectId, baseUpdate);
    }

    let currentState =
      (await this.config.store.getProjectState(params.projectId)) ?? params.projectState;

    const structuredUpdate = await this.buildStructuredUpdate({
      userInput: params.userInput,
      projectId: params.projectId,
      requestId: params.requestId,
      projectState: currentState,
    });

    if (
      structuredUpdate.newDecisions?.length ||
      structuredUpdate.newDecision ||
      structuredUpdate.newInvariants?.length ||
      structuredUpdate.newInvariant
    ) {
      await this.config.store.applyMemoryUpdate(params.projectId, structuredUpdate);
    }

    return { ...baseUpdate, ...structuredUpdate };
  }

  private async buildStructuredUpdate(params: {
    userInput: string;
    projectId: string;
    requestId?: string;
    projectState: ProjectState;
  }): Promise<MemoryUpdate> {
    const limit = extractLimit();
    const memoryUpdate: MemoryUpdate = {};
    const newDecisions: NonNullable<MemoryUpdate["newDecisions"]> = [];
    const newInvariants: NonNullable<MemoryUpdate["newInvariants"]> = [];

    const explicit = parseExplicitMemory(params.userInput);
    const explicitMapped = explicitToMemoryUpdate(params.projectId, explicit);

    for (const d of explicitMapped.newDecisions) {
      if (!decisionAlreadyExists(params.projectState, d.decision)) {
        newDecisions.push(DecisionNodeSchema.parse(d));
      }
    }
    for (const inv of explicitMapped.newInvariants) {
      if (!invariantAlreadyExists(params.projectState, inv.rule)) {
        newInvariants.push(InvariantSchema.parse(inv));
      }
    }

    if (this.llmCompiler && newDecisions.length + newInvariants.length < limit) {
      try {
        const events = await this.config.store.getEvents(params.projectId, 30);
        const compiled = await this.llmCompiler.compileEvents(events, {
          requestId: params.requestId,
          projectId: params.projectId,
        });

        for (const d of compiled.decisions) {
          if (newDecisions.length >= limit) break;
          const decisionText = d.decision ?? "";
          if (!decisionText || decisionAlreadyExists(params.projectState, decisionText)) continue;
          newDecisions.push(
            DecisionNodeSchema.parse({
              id: randomUUID(),
              projectId: params.projectId,
              decision: decisionText,
              reason: d.reason ?? [],
              rejectedAlternatives: d.rejectedAlternatives ?? [],
              consequencesExpected: d.consequencesExpected ?? [],
              consequencesObserved: [],
              linkedFiles: d.linkedFiles ?? [],
              linkedModules: d.linkedModules ?? [],
              linkedRisks: d.linkedRisks ?? [],
              status: "active",
              createdAt: new Date(),
            })
          );
        }

        for (const inv of compiled.invariants) {
          if (newInvariants.length >= limit) break;
          const ruleText = inv.rule ?? "";
          if (!ruleText || invariantAlreadyExists(params.projectState, ruleText)) continue;
          newInvariants.push(
            InvariantSchema.parse({
              id: randomUUID(),
              projectId: params.projectId,
              rule: ruleText,
              reason: inv.reason ?? "",
              severity: inv.severity ?? "soft",
              appliesTo: inv.appliesTo ?? [],
              createdAt: new Date(),
            })
          );
        }
      } catch {
        // fail-soft: events already saved
      }
    }

    if (newDecisions.length) memoryUpdate.newDecisions = newDecisions;
    if (newInvariants.length) memoryUpdate.newInvariants = newInvariants;
    return memoryUpdate;
  }
}
