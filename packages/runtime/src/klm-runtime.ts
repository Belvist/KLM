import { randomUUID } from "node:crypto";
import { buildConversationContext } from "@klm/core";
import type {
  Event,
  KlmRequest,
  KlmResponse,
  ProjectState,
  Situation,
} from "@klm/core";
import { MemoryPipeline, RuleBasedMemoryActivator, type MemoryType } from "@klm/memory-core";
import type { ModelRouter } from "@klm/model-adapters";
import type { StateStore } from "@klm/state-store";
import { CompositeVerifier, rankActions, simulateFutures } from "@klm/verifier";
import { generateCandidateActions } from "./actions.js";
import { IntentEngine } from "./intent-engine.js";
import { RealityCompiler } from "./reality-compiler.js";

export interface KlmRuntimeConfig {
  store: StateStore;
  router: ModelRouter;
  enableLlmMemoryCompiler?: boolean;
}

export class KlmRuntime {
  private intentEngine: IntentEngine;
  private memoryActivator: RuleBasedMemoryActivator;
  private memoryPipeline: MemoryPipeline;
  private verifier: CompositeVerifier;
  private compiler: RealityCompiler;

  constructor(private config: KlmRuntimeConfig) {
    this.intentEngine = new IntentEngine(config.router);
    this.memoryActivator = new RuleBasedMemoryActivator();
    this.memoryPipeline = new MemoryPipeline({
      store: config.store,
      router: config.router,
      enableLlmCompiler: config.enableLlmMemoryCompiler,
    });
    this.verifier = new CompositeVerifier(config.router);
    this.compiler = new RealityCompiler(config.router);
  }

  async handleRequest(request: KlmRequest): Promise<KlmResponse> {
    const { tenant, input, modelOverride, messageHistory } = request;
    const projectId = tenant.projectId;
    const userId = tenant.userId;

    const recentContext = messageHistory?.length
      ? buildConversationContext(messageHistory)
      : [];

    await this.saveEvent(projectId, userId, input, request.client);

    const intent = await this.intentEngine.parse(input);

    let projectState = await this.config.store.getProjectState(projectId);
    if (!projectState) {
      projectState = await this.ensureProject(projectId, tenant.workspaceId);
    }

    const recentEvents = await this.config.store.getEvents(projectId, 20);

    const situation: Situation = {
      intent,
      projectId,
      userId,
      recentContext,
      activatedMemoryTypes: [
        "decisions",
        "invariants",
        "risks",
        "codebase",
        "roadmap",
        "temporal",
      ],
    };

    const memoryTypes: MemoryType[] = [
      "decisions",
      "invariants",
      "risks",
      "codebase",
      "roadmap",
      "temporal",
    ];

    const memoryContext = await this.memoryActivator.activate(
      situation,
      projectState,
      memoryTypes,
      recentEvents
    );

    const candidateActions = generateCandidateActions(situation, memoryContext);
    const simulated = simulateFutures(candidateActions, projectState);
    const ranked = rankActions(candidateActions, simulated, projectState);

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

    await this.memoryPipeline.afterResponse({
      userInput: input,
      output: compiled.content,
      projectId,
      userId,
      projectState,
      situation,
    });

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

  /**
   * fast_stream: streams from model when KLM_STREAM_MODE=fast_stream (Phase 1.5).
   * default: buffered completion split into chunks (compatible with verifier-first path).
   */
  async *handleRequestStream(
    request: KlmRequest
  ): AsyncIterable<{ type: "chunk" | "done"; content?: string; response?: KlmResponse }> {
    const mode = process.env.KLM_STREAM_MODE ?? "buffered";

    if (mode === "fast_stream") {
      yield* this.streamFromModel(request);
      return;
    }

    const response = await this.handleRequest({ ...request, stream: false });
    for (const word of response.output.split(/(\s+)/)) {
      if (word) yield { type: "chunk", content: word };
    }
    yield { type: "done", response };
  }

  private async *streamFromModel(
    request: KlmRequest
  ): AsyncIterable<{ type: "chunk" | "done"; content?: string; response?: KlmResponse }> {
    const response = await this.handleRequest({ ...request, stream: false });
    const taskType = "general";
    const messages = [
      {
        role: "system" as const,
        content: "Continue the assistant response based on KLM analysis.",
      },
      { role: "user" as const, content: request.input },
      { role: "assistant" as const, content: response.output.slice(0, 500) },
    ];

    for await (const chunk of this.config.router.stream(taskType, {
      messages,
      stream: true,
      jsonMode: false,
    })) {
      if (chunk.content) yield { type: "chunk", content: chunk.content };
      if (chunk.done) break;
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
}

export { IntentEngine } from "./intent-engine.js";
export { RealityCompiler } from "./reality-compiler.js";
