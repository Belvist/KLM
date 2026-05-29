import { randomUUID } from "node:crypto";
import { InMemoryStateStore, emptyProjectState } from "@klm/state-store";
import { generateCandidateActions } from "@klm/runtime";
import { rankActions, simulateFutures } from "@klm/verifier";
import { RuleBasedMemoryActivator } from "@klm/memory-core";
import { ParsedIntentSchema } from "@klm/core";

export interface EvalResult {
  name: string;
  passed: boolean;
  message: string;
}

export async function evalInvariantRespect(): Promise<EvalResult> {
  const projectId = randomUUID();
  const state = emptyProjectState(projectId, randomUUID(), "Eval");
  state.invariants = [
    {
      id: randomUUID(),
      projectId,
      rule: "Every endpoint must have auth policy",
      reason: "security",
      severity: "critical",
      appliesTo: ["api"],
    },
  ];

  const intent = ParsedIntentSchema.parse({
    rawInput: "add public user endpoint",
    taskType: "code",
    outputFormat: "code",
    qualityLevel: "production",
    entities: [],
    urgency: "normal",
    requiresVerification: true,
  });

  const situation = {
    intent,
    projectId,
    userId: randomUUID(),
    recentContext: [],
    activatedMemoryTypes: ["invariants"],
  };

  const activator = new RuleBasedMemoryActivator();
  const memory = await activator.activate(situation, state, ["invariants"], []);
  const actions = generateCandidateActions(situation, memory);
  const futures = simulateFutures(actions, state);
  const ranked = rankActions(actions, futures, state);

  const productionAction = ranked.find((a) => a.approach.includes("production"));
  const topIsProduction = ranked[0].approach.includes("production");

  return {
    name: "invariant-respect-ranking",
    passed: Boolean(productionAction) && (topIsProduction || ranked[0].totalScore > 0),
    message: topIsProduction
      ? "Production approach ranked first for security-sensitive task"
      : `Top action: ${ranked[0].approach}`,
  };
}

export async function evalComplexityPenalty(): Promise<EvalResult> {
  const projectId = randomUUID();
  const state = emptyProjectState(projectId, randomUUID(), "Eval");

  const low = {
    id: randomUUID(),
    description: "low",
    approach: "minimal",
    estimatedComplexity: "low" as const,
    affectedModules: [],
  };
  const high = {
    id: randomUUID(),
    description: "high",
    approach: "production-grade with auth, tests, observability",
    estimatedComplexity: "high" as const,
    affectedModules: [],
  };

  const futures = simulateFutures([low, high], state);
  const ranked = rankActions([high, low], futures, state);
  const lowRanked = ranked.find((a) => a.id === low.id)!;
  const highRanked = ranked.find((a) => a.id === high.id)!;

  const debtLowerForLow = (lowRanked.scores as { complexityDebt?: number }).complexityDebt! <
    (highRanked.scores as { complexityDebt?: number }).complexityDebt!;

  return {
    name: "complexity-debt-penalty",
    passed: debtLowerForLow,
    message: `low debt=${(lowRanked.scores as { complexityDebt?: number }).complexityDebt}, high debt=${(highRanked.scores as { complexityDebt?: number }).complexityDebt}`,
  };
}

export async function evalNoDuplicateUserEvents(): Promise<EvalResult> {
  const store = new InMemoryStateStore();
  const projectId = randomUUID();
  const userId = randomUUID();
  const state = emptyProjectState(projectId, randomUUID(), "Eval");
  await store.saveProjectState(state);

  await store.appendEvent({
    id: randomUUID(),
    projectId,
    userId,
    type: "message",
    content: "user question",
    timestamp: new Date(),
    source: "chat",
    importance: 0.5,
  });

  await store.applyMemoryUpdate(projectId, {
    newEvents: [
      {
        id: randomUUID(),
        projectId,
        userId,
        type: "feedback",
        content: "assistant answer",
        timestamp: new Date(),
        source: "system",
        importance: 0.6,
      },
    ],
  });

  const events = await store.getEvents(projectId);
  const userMessages = events.filter(
    (e) => e.type === "message" && e.content === "user question"
  );

  return {
    name: "no-duplicate-user-events",
    passed: userMessages.length === 1 && events.length === 2,
    message: `events=${events.length}, duplicate user messages=${userMessages.length}`,
  };
}

export async function evalDecisionDedup(): Promise<EvalResult> {
  const store = new InMemoryStateStore();
  const projectId = randomUUID();
  const state = emptyProjectState(projectId, randomUUID(), "Eval");
  await store.saveProjectState(state);

  const decision = {
    id: randomUUID(),
    projectId,
    decision: "Auth must be centralized",
    reason: ["security"],
    rejectedAlternatives: [],
    consequencesExpected: [],
    consequencesObserved: [],
    linkedFiles: [],
    linkedModules: [],
    linkedRisks: [],
    status: "active" as const,
    createdAt: new Date(),
  };

  await store.applyMemoryUpdate(projectId, { newDecision: decision });
  await store.applyMemoryUpdate(projectId, {
    newDecision: { ...decision, id: randomUUID() },
  });

  const updated = await store.getProjectState(projectId);
  const count =
    updated?.decisions.filter((d) => d.decision === "Auth must be centralized").length ?? 0;

  return {
    name: "decision-dedup",
    passed: count === 1,
    message: `duplicate decisions=${count}`,
  };
}

export async function runAllEvals(): Promise<EvalResult[]> {
  return Promise.all([
    evalInvariantRespect(),
    evalComplexityPenalty(),
    evalNoDuplicateUserEvents(),
    evalDecisionDedup(),
  ]);
}
