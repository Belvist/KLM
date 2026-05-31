import { randomUUID } from "node:crypto";
import { InMemoryStateStore, emptyProjectState } from "@klm/state-store";
import {
  parseArchitectureInvariantsMarkdown,
  parseDecisionsMarkdown,
  parseExplicitMemory,
  explicitToMemoryUpdate,
  MemoryPipeline,
  RuleBasedMemoryActivator,
  findPlatformMemoryLeaks,
  hasEarflowMemory,
  KLM_PLATFORM_MEMORY_MARKERS,
} from "@klm/memory-core";
import type { EvalResult } from "./scenarios.js";

export async function runMemoryPipelineEvals(): Promise<EvalResult[]> {
  const results: EvalResult[] = [];

  const invMd = `### INV-FE-003 — Single pointer owner
All gestures via arbiter.
- **Красный флаг:** raw onTouchStart
`;
  const parsedInv = parseArchitectureInvariantsMarkdown(invMd);
  results.push({
    name: "docs-importer-invariants",
    passed: parsedInv.length === 1 && parsedInv[0]!.rule.includes("INV-FE-003"),
    message: `parsed=${parsedInv.length}`,
  });

  const decMd = `## 2026-05-30 — Queue panel gestures

**Status:** accepted
**Area:** frontend-player
**Context:** collapse broken
**Decision:**
1. Handle-only queue gestures
**Alternatives considered:**
- *Keep height transition:* rejected
**Consequences:**
- Real touch works
**Files touched:**
- \`frontend/src/useQueuePanelGesture.js\`
`;
  const parsedDec = parseDecisionsMarkdown(decMd);
  results.push({
    name: "docs-importer-decisions",
    passed: parsedDec.length === 1 && parsedDec[0]!.decision.includes("Queue panel"),
    message: parsedDec[0]?.decision ?? "none",
  });

  const explicit = parseExplicitMemory(`
Record to project memory:
Invariants:
- INV-FE-003: Single pointer owner via GestureArbiter
- [INV-FE-004] touch-action on drag surfaces
Decisions:
- Queue panel handle-only with instant snap
`);
  results.push({
    name: "explicit-memory-parse",
    passed: explicit.invariants.length >= 2 && explicit.decisions.length >= 1,
    message: `inv=${explicit.invariants.length} dec=${explicit.decisions.length}`,
  });

  const projectId = randomUUID();
  const store = new InMemoryStateStore();
  const state = emptyProjectState(projectId, randomUUID(), "Eval");
  await store.saveProjectState(state);

  const mapped = explicitToMemoryUpdate(projectId, explicit);
  await store.applyMemoryUpdate(projectId, {
    newDecisions: mapped.newDecisions,
    newInvariants: mapped.newInvariants,
  });
  const updated = await store.getProjectState(projectId);
  results.push({
    name: "bulk-memory-update",
    passed: (updated?.decisions.length ?? 0) >= 1 && (updated?.invariants.length ?? 0) >= 2,
    message: `decisions=${updated?.decisions.length} invariants=${updated?.invariants.length}`,
  });

  process.env.KLM_MEMORY_EVENT_SNIPPET_CHARS = "800";
  const longEvent = {
    id: randomUUID(),
    projectId,
    userId: randomUUID(),
    type: "message" as const,
    content: "x".repeat(1200),
    timestamp: new Date(),
    source: "ide" as const,
    importance: 0.8,
  };
  const activator = new RuleBasedMemoryActivator();
  const activated = await activator.activate(
    {
      intent: {
        rawInput: "gesture",
        taskType: "question",
        outputFormat: "explanation",
        qualityLevel: "balanced",
        entities: [],
        urgency: "normal",
        requiresVerification: false,
      },
      projectId,
      userId: randomUUID(),
      recentContext: [],
      activatedMemoryTypes: ["invariants"],
    },
    state,
    ["invariants"],
    [longEvent]
  );
  results.push({
    name: "activator-event-snippet-800",
    passed: activated.contextSummary.includes("x".repeat(800)),
    message: `snippetLen=${activated.contextSummary.match(/x+/)?.[0]?.length ?? 0}`,
  });

  const pipeline = new MemoryPipeline({ store, enableLlmCompiler: false });
  await pipeline.afterResponse({
    userInput: "INV-FE-005: Mobile e2e must use real touch",
    output: "ack",
    projectId,
    userId: randomUUID(),
    projectState: updated ?? state,
    situation: {
      intent: {
        rawInput: "test",
        taskType: "question",
        outputFormat: "explanation",
        qualityLevel: "balanced",
        entities: [],
        urgency: "normal",
        requiresVerification: false,
      },
      projectId,
      userId: randomUUID(),
      recentContext: [],
      activatedMemoryTypes: [],
    },
  });
  const afterPipeline = await store.getProjectState(projectId);
  const hasFe005 = afterPipeline?.invariants.some((i) => i.rule.includes("INV-FE-005"));
  results.push({
    name: "pipeline-explicit-invariant",
    passed: Boolean(hasFe005),
    message: hasFe005 ? "INV-FE-005 stored" : "missing",
  });

  delete process.env.KLM_MEMORY_EVENT_SNIPPET_CHARS;

  const leaked = findPlatformMemoryLeaks({
    name: "KLM Runtime Live",
    invariants: [{ rule: KLM_PLATFORM_MEMORY_MARKERS[0]! }],
    decisions: [],
  });
  results.push({
    name: "platform-isolation-detects-leak",
    passed: leaked.length > 0,
    message: leaked.join(", ") || "none",
  });

  results.push({
    name: "platform-isolation-earflow-marker",
    passed: hasEarflowMemory({ invariants: [{ rule: "[INV-FE-003] gesture owner" }] }),
    message: "INV-FE detected",
  });

  return results;
}
