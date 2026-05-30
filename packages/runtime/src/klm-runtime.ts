import { randomUUID } from "node:crypto";
import { buildConversationContext } from "@klm/core";
import type { Event, KlmRequest, KlmResponse, ProjectState, Situation } from "@klm/core";
import { disabledCodebaseActivationReport, publicCodebaseActivationReport } from "@klm/core";
import type { AuditLogger } from "@klm/audit";
import { auditFromTenant } from "@klm/audit";
import type { MemoryActivator } from "@klm/memory-core";
import { MemoryPipeline, RuleBasedMemoryActivator, type MemoryType } from "@klm/memory-core";
import type { ModelRouter } from "@klm/model-adapters";
import type { SemanticMemoryIndexer } from "@klm/semantic-memory";
import type { StateStore } from "@klm/state-store";
import { CompositeVerifier, rankActions, simulateFutures } from "@klm/verifier";
import { generateCandidateActions } from "./actions.js";
import { IntentEngine } from "./intent-engine.js";
import { RealityCompiler } from "./reality-compiler.js";

export interface KlmRuntimeConfig {
  store: StateStore;
  router: ModelRouter;
  memoryActivator?: MemoryActivator;
  memoryPipeline?: MemoryPipeline;
  semanticIndexer?: SemanticMemoryIndexer;
  audit?: AuditLogger;
  enableLlmMemoryCompiler?: boolean;
}

export class KlmRuntime {
  private intentEngine: IntentEngine;
  private memoryActivator: MemoryActivator;
  private memoryPipeline: MemoryPipeline;
  private verifier: CompositeVerifier;
  private compiler: RealityCompiler;
  private audit?: AuditLogger;
  private semanticIndexer?: SemanticMemoryIndexer;

  constructor(private config: KlmRuntimeConfig) {
    this.intentEngine = new IntentEngine(config.router);
    this.memoryActivator = config.memoryActivator ?? new RuleBasedMemoryActivator();
    this.memoryPipeline =
      config.memoryPipeline ??
      new MemoryPipeline({
        store: config.store,
        router: config.router,
        enableLlmCompiler: config.enableLlmMemoryCompiler,
      });
    this.verifier = new CompositeVerifier(config.router);
    this.compiler = new RealityCompiler(config.router);
    this.audit = config.audit;
    this.semanticIndexer = config.semanticIndexer;
  }

  async handleRequest(request: KlmRequest): Promise<KlmResponse> {
    const response = await this.executeLoop(request, { stream: false });
    return response;
  }

  /**
   * True streaming: reasoning loop runs once; RealityCompiler streams model tokens.
   * Memory update runs after the full response is buffered.
   */
  async *handleRequestStream(
    request: KlmRequest
  ): AsyncIterable<{ type: "chunk" | "done"; content?: string; response?: KlmResponse }> {
    yield* this.handleRequestStreamInner(request);
  }

  private async *handleRequestStreamInner(
    request: KlmRequest
  ): AsyncIterable<{ type: "chunk" | "done"; content?: string; response?: KlmResponse }> {
    const ctx = await this.prepareContext(request);
    let fullContent = "";

    for await (const chunk of this.compiler.compileStream({
      verifiedAction: ctx.verified,
      outputType: ctx.intent.outputFormat,
      intent: ctx.intent,
      projectState: ctx.projectState,
      memoryContext: ctx.memoryContext.contextSummary,
      requestId: request.tenant.requestId,
      projectId: ctx.projectId,
    })) {
      fullContent += chunk;
      yield { type: "chunk", content: chunk };
    }

    const compiled = {
      type: ctx.intent.outputFormat,
      content: fullContent,
      artifacts: [],
      warnings: ctx.verified.violations.filter((v) => !v.repaired).map((v) => v.message),
    };

    await this.memoryPipeline.afterResponse({
      userInput: request.input,
      output: fullContent,
      projectId: ctx.projectId,
      userId: ctx.userId,
      requestId: request.tenant.requestId,
      projectState: ctx.projectState,
      situation: ctx.situation,
    });

    await this.indexSemanticMemory(ctx.projectId);

    const route = this.config.router.resolveRoute(
      ctx.intent.taskType === "code" ? "codegen" : "general",
      request.modelOverride
    );

    const response: KlmResponse = {
      requestId: request.tenant.requestId,
      output: fullContent,
      modelUsed: route.model,
      providerUsed: route.provider,
      memoryUpdated: true,
      verificationPassed: ctx.verified.passed,
      warnings: compiled.warnings,
      codebaseActivation: ctx.codebaseActivation,
    };

    await this.audit?.log(
      auditFromTenant(request.tenant, "completion", "klm-runtime", {
        stream: true,
        verificationPassed: ctx.verified.passed,
      })
    );

    yield { type: "done", response };
  }

  private async executeLoop(
    request: KlmRequest,
    _options: { stream: boolean }
  ): Promise<KlmResponse> {
    return this.executeLoopInner(request);
  }

  private async executeLoopInner(request: KlmRequest): Promise<KlmResponse> {
    const ctx = await this.prepareContext(request);

    const compiled = await this.compiler.compile({
      verifiedAction: ctx.verified,
      outputType: ctx.intent.outputFormat,
      intent: ctx.intent,
      projectState: ctx.projectState,
      memoryContext: ctx.memoryContext.contextSummary,
      requestId: request.tenant.requestId,
      projectId: ctx.projectId,
    });

    await this.memoryPipeline.afterResponse({
      userInput: request.input,
      output: compiled.content,
      projectId: ctx.projectId,
      userId: ctx.userId,
      requestId: request.tenant.requestId,
      projectState: ctx.projectState,
      situation: ctx.situation,
    });

    await this.indexSemanticMemory(ctx.projectId);

    const route = this.config.router.resolveRoute(
      ctx.intent.taskType === "code" ? "codegen" : "general",
      request.modelOverride
    );

    await this.audit?.log(
      auditFromTenant(request.tenant, "completion", "klm-runtime", {
        verificationPassed: ctx.verified.passed,
      })
    );

    return {
      requestId: request.tenant.requestId,
      output: compiled.content,
      modelUsed: route.model,
      providerUsed: route.provider,
      memoryUpdated: true,
      verificationPassed: ctx.verified.passed,
      warnings: compiled.warnings,
      codebaseActivation: ctx.codebaseActivation,
    };
  }

  private async prepareContext(request: KlmRequest) {
    const { tenant, input, messageHistory } = request;
    const projectId = tenant.projectId;
    const userId = tenant.userId;
    const modelScope = {
      requestId: tenant.requestId,
      projectId: tenant.projectId,
    };

    const recentContext = messageHistory?.length ? buildConversationContext(messageHistory) : [];

    let projectState = await this.config.store.getProjectState(projectId);
    if (!projectState) {
      projectState = await this.ensureProject(projectId, tenant.workspaceId);
    }

    await this.saveEvent(projectId, userId, input, request.client);

    const intent = await this.intentEngine.parse(input, modelScope);
    const recentEvents = await this.config.store.getEvents(projectId, 20);

    const situation: Situation = {
      intent,
      projectId,
      userId,
      recentContext,
      activatedMemoryTypes: ["decisions", "invariants", "risks", "codebase", "roadmap", "temporal"],
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

    const codebaseActivation = publicCodebaseActivationReport(
      memoryContext.codebaseActivation ?? disabledCodebaseActivationReport()
    );

    await this.audit?.log(
      auditFromTenant(tenant, "codebase_activation", "klm-runtime", {
        activationUsed: codebaseActivation.activationUsed,
        reason: codebaseActivation.reason,
        searchTerms: codebaseActivation.searchTerms,
        counts: codebaseActivation.counts,
      })
    );

    const candidateActions = generateCandidateActions(situation, memoryContext);
    const simulated = simulateFutures(candidateActions, projectState);
    const ranked = rankActions(candidateActions, simulated, projectState);
    const verified = await this.verifier.verifyAndRepair(
      ranked[0],
      projectState.invariants,
      projectState,
      modelScope
    );

    await this.audit?.log(
      auditFromTenant(tenant, "reasoning", "klm-runtime", {
        taskType: intent.taskType,
        actionRank: verified.rank,
      })
    );

    return {
      projectId,
      userId,
      intent,
      projectState,
      situation,
      memoryContext,
      verified,
      codebaseActivation,
    };
  }

  private async indexSemanticMemory(projectId: string): Promise<void> {
    if (!this.semanticIndexer) return;
    try {
      const state = await this.config.store.getProjectState(projectId);
      const events = await this.config.store.getEvents(projectId, 20);
      if (state) {
        await this.semanticIndexer.indexProjectState(projectId, state);
      }
      if (events.length) {
        await this.semanticIndexer.indexEvents(projectId, events);
      }
    } catch (err) {
      console.warn("[klm] semantic index skipped:", (err as Error).message);
    }
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

  private async ensureProject(projectId: string, workspaceId: string): Promise<ProjectState> {
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
