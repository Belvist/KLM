import { randomUUID } from "node:crypto";
import type {
  CompiledOutput,
  Event,
  KlmRequest,
  KlmResponse,
  ProjectState,
  Situation,
} from "@klm/core";
import {
  BasicMemoryUpdater,
  RuleBasedMemoryActivator,
  type MemoryType,
} from "@klm/memory-core";
import type { ModelRouter } from "@klm/model-adapters";
import type { StateStore } from "@klm/state-store";
import { CompositeVerifier, rankActions, simulateFutures } from "@klm/verifier";
import { generateCandidateActions } from "./actions.js";
import { IntentEngine } from "./intent-engine.js";
import { RealityCompiler } from "./reality-compiler.js";

export interface KlmRuntimeConfig {
  store: StateStore;
  router: ModelRouter;
}

export class KlmRuntime {
  private intentEngine: IntentEngine;
  private memoryActivator: RuleBasedMemoryActivator;
  private memoryUpdater: BasicMemoryUpdater;
  private verifier: CompositeVerifier;
  private compiler: RealityCompiler;

  constructor(private config: KlmRuntimeConfig) {
    this.intentEngine = new IntentEngine(config.router);
    this.memoryActivator = new RuleBasedMemoryActivator();
    this.memoryUpdater = new BasicMemoryUpdater();
    this.verifier = new CompositeVerifier(config.router);
    this.compiler = new RealityCompiler(config.router);
  }

  async handleRequest(request: KlmRequest): Promise<KlmResponse> {
    const { tenant, input, modelOverride } = request;
    const projectId = tenant.projectId;
    const userId = tenant.userId;

    await this.saveEvent(projectId, userId, input, request.client);

    const intent = await this.intentEngine.parse(input);

    let projectState = await this.config.store.getProjectState(projectId);
    if (!projectState) {
      projectState = await this.ensureProject(projectId, tenant.workspaceId);
    }

    const situation: Situation = {
      intent,
      projectId,
      userId,
      recentContext: [],
      activatedMemoryTypes: [
        "decisions",
        "invariants",
        "risks",
        "codebase",
        "roadmap",
      ],
    };

    const memoryTypes: MemoryType[] = [
      "decisions",
      "invariants",
      "risks",
      "codebase",
      "roadmap",
    ];

    const memoryContext = await this.memoryActivator.activate(
      situation,
      projectState,
      memoryTypes
    );

    const candidateActions = generateCandidateActions(situation, memoryContext);
    const simulated = simulateFutures(candidateActions);
    const ranked = rankActions(candidateActions, simulated);

    const verified = await this.verifier.verifyAndRepair(
      ranked[0],
      projectState.invariants,
      projectState
    );

    const compiled = await this.compiler.compile({
      verifiedAction: verified,
      outputType: intent.outputFormat,
      intent,
      projectState,
      memoryContext: memoryContext.contextSummary,
    });

    await this.updateMemory(userId, projectId, input, situation, compiled, projectState);

    const route = this.config.router.resolveRoute(
      intent.taskType === "code" ? "codegen" : "general",
      modelOverride
    );

    return {
      requestId: tenant.requestId,
      output: compiled.content,
      modelUsed: route.model,
      providerUsed: route.provider,
      memoryUpdated: true,
      verificationPassed: verified.passed,
      warnings: compiled.warnings,
    };
  }

  async *handleRequestStream(
    request: KlmRequest
  ): AsyncIterable<{ type: "chunk" | "done"; content?: string; response?: KlmResponse }> {
    const response = await this.handleRequest({ ...request, stream: false });
    const words = response.output.split(/(\s+)/);
    for (const word of words) {
      yield { type: "chunk", content: word };
    }
    yield { type: "done", response };
  }

  private async saveEvent(
    projectId: string,
    userId: string,
    content: string,
    source: KlmRequest["client"]
  ): Promise<void> {
    const event: Event = {
      id: randomUUID(),
      projectId,
      userId,
      type: "message",
      content,
      timestamp: new Date(),
      source: source === "mcp" || source === "cursor" || source === "vscode" ? "ide" : "chat",
      importance: 0.5,
    };
    await this.config.store.appendEvent(event);
  }

  private async ensureProject(
    projectId: string,
    workspaceId: string
  ): Promise<ProjectState> {
    const state = await this.config.store.getProjectState(projectId);
    if (state) return state;

    const newState: ProjectState = {
      id: projectId,
      workspaceId,
      name: "Default Project",
      description: "",
      goals: [],
      businessModel: [],
      architecture: { summary: "", components: [], dataFlows: [] },
      techStack: { languages: [], frameworks: [], databases: [], infra: [], tools: [] },
      invariants: [],
      decisions: [],
      risks: [],
      roadmap: [],
      codebaseMap: { rootPath: ".", fileCount: 0, modules: [] },
      updatedAt: new Date(),
    };
    await this.config.store.saveProjectState(newState);
    return newState;
  }

  private async updateMemory(
    _userId: string,
    projectId: string,
    input: string,
    situation: Situation,
    output: CompiledOutput,
    projectState: ProjectState
  ): Promise<void> {
    const update = await this.memoryUpdater.buildUpdate({
      userInput: input,
      situation,
      output: output.content,
      projectState,
    });
    await this.config.store.applyMemoryUpdate(projectId, update);
  }
}

export { IntentEngine } from "./intent-engine.js";
export { RealityCompiler } from "./reality-compiler.js";
