import { randomUUID } from "node:crypto";
import type { MemoryUpdate, ProjectState } from "@klm/core";
import { DecisionNodeSchema, InvariantSchema } from "@klm/core";
import type { ModelRouter } from "@klm/model-adapters";
import type { StateStore } from "@klm/state-store";
import { BasicMemoryUpdater, LlmMemoryCompiler } from "./compiler.js";

export interface MemoryPipelineConfig {
  store: StateStore;
  router?: ModelRouter;
  enableLlmCompiler?: boolean;
}

/**
 * event saved → compile → validate → persist
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
    projectState: ProjectState;
    situation: import("@klm/core").Situation;
  }): Promise<MemoryUpdate> {
    const baseUpdate = await this.basicUpdater.buildUpdate({
      userInput: params.userInput,
      situation: params.situation,
      output: params.output,
      projectState: params.projectState,
    });

    await this.config.store.applyMemoryUpdate(params.projectId, baseUpdate);

    if (!this.llmCompiler) {
      return baseUpdate;
    }

    let compiled: Awaited<ReturnType<LlmMemoryCompiler["compileEvents"]>>;
    try {
      const events = await this.config.store.getEvents(params.projectId, 30);
      compiled = await this.llmCompiler.compileEvents(events);
    } catch {
      return baseUpdate;
    }

    const memoryUpdate: MemoryUpdate = {};

    if (compiled.decisions[0]) {
      const d = compiled.decisions[0];
      memoryUpdate.newDecision = DecisionNodeSchema.parse({
        id: randomUUID(),
        projectId: params.projectId,
        decision: d.decision ?? "Unnamed decision",
        reason: d.reason ?? [],
        rejectedAlternatives: d.rejectedAlternatives ?? [],
        consequencesExpected: d.consequencesExpected ?? [],
        consequencesObserved: [],
        linkedFiles: d.linkedFiles ?? [],
        linkedModules: d.linkedModules ?? [],
        linkedRisks: d.linkedRisks ?? [],
        status: "active",
        createdAt: new Date(),
      });
    }

    if (compiled.invariants[0]) {
      const inv = compiled.invariants[0];
      memoryUpdate.newInvariant = InvariantSchema.parse({
        id: randomUUID(),
        projectId: params.projectId,
        rule: inv.rule ?? "Unnamed rule",
        reason: inv.reason ?? "",
        severity: inv.severity ?? "soft",
        appliesTo: inv.appliesTo ?? [],
        createdAt: new Date(),
      });
    }

    if (memoryUpdate.newDecision || memoryUpdate.newInvariant) {
      await this.config.store.applyMemoryUpdate(params.projectId, memoryUpdate);
    }

    return { ...baseUpdate, ...memoryUpdate };
  }
}
