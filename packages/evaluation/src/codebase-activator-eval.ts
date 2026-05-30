import { randomUUID } from "node:crypto";
import {
  CodebaseMemoryActivator,
  countActivationBlockItems,
  formatCodebaseActivationBlock,
  resolveCodebaseActivationLimit,
  sanitizeActivationSearchTerms,
  trimActivationSearchResult,
  type CodebaseQueryReader,
  type CodebaseSearchResult,
} from "@klm/codebase-indexer";
import { ParsedIntentSchema } from "@klm/core";
import type { ActivatedMemory, MemoryActivator } from "@klm/memory-core";
import { emptyProjectState } from "@klm/state-store";

export interface EvalResult {
  name: string;
  passed: boolean;
  message: string;
}

function makeSituation(rawInput: string, projectId: string) {
  return {
    intent: ParsedIntentSchema.parse({
      rawInput,
      taskType: "code",
      outputFormat: "mixed",
      qualityLevel: "balanced",
      entities: [],
      urgency: "normal",
      requiresVerification: true,
    }),
    projectId,
    userId: randomUUID(),
    recentContext: [],
    activatedMemoryTypes: ["codebase"],
  };
}

function sampleSearchResult(count: number): CodebaseSearchResult {
  const routes = Array.from({ length: count }, (_, i) => ({
    id: randomUUID(),
    filePath: `apps/api/src/r${i}.ts`,
    httpMethod: "GET",
    path: `/route-${i}`,
    lineNumber: i + 1,
  }));
  return { query: "test", files: [], routes, symbols: [], dependencies: [] };
}

export async function evalCodebaseActivationLimitCap(): Promise<EvalResult> {
  const previous = process.env.KLM_CODEBASE_ACTIVATION_LIMIT;
  process.env.KLM_CODEBASE_ACTIVATION_LIMIT = "5000";

  try {
    const resolved = resolveCodebaseActivationLimit();
    const trimmed = trimActivationSearchResult(sampleSearchResult(250), resolved);
    const itemCount = countActivationBlockItems(trimmed);

    return {
      name: "codebase-activation-limit-hard-cap",
      passed: resolved === 100 && itemCount === 100,
      message: `env=5000 → resolved=${resolved}, items=${itemCount}`,
    };
  } finally {
    if (previous === undefined) delete process.env.KLM_CODEBASE_ACTIVATION_LIMIT;
    else process.env.KLM_CODEBASE_ACTIVATION_LIMIT = previous;
  }
}

export async function evalCodebaseActivationLimitInvalid(): Promise<EvalResult> {
  const previous = process.env.KLM_CODEBASE_ACTIVATION_LIMIT;
  process.env.KLM_CODEBASE_ACTIVATION_LIMIT = "abc";

  try {
    const resolved = resolveCodebaseActivationLimit();
    return {
      name: "codebase-activation-limit-invalid-default",
      passed: resolved === 50,
      message: `invalid env → resolved=${resolved}`,
    };
  } finally {
    if (previous === undefined) delete process.env.KLM_CODEBASE_ACTIVATION_LIMIT;
    else process.env.KLM_CODEBASE_ACTIVATION_LIMIT = previous;
  }
}

export async function evalCodebaseActivationInnerMemoryPreserved(): Promise<EvalResult> {
  const projectId = randomUUID();
  const state = emptyProjectState(projectId, randomUUID(), "Eval");
  const innerInvariant = {
    id: randomUUID(),
    projectId,
    rule: "INNER_INVARIANT_MARKER",
    reason: "test",
    severity: "soft" as const,
    appliesTo: [],
  };

  const inner: MemoryActivator = {
    activate: async () =>
      ({
        decisions: [],
        invariants: [innerInvariant],
        risks: [],
        recentEvents: [],
        principles: ["INNER_PRINCIPLE"],
        contextSummary: "INNER_CONTEXT_MARKER",
      }) satisfies ActivatedMemory,
  };

  const reader = {
    search: async () => ({
      query: "health",
      files: [],
      routes: [
        {
          id: randomUUID(),
          filePath: "apps/api/src/health.ts",
          httpMethod: "GET",
          path: "/health",
          lineNumber: 10,
        },
      ],
      symbols: [],
      dependencies: [],
    }),
    close: async () => {},
  } as unknown as CodebaseQueryReader;

  const activator = new CodebaseMemoryActivator(inner, reader, 50);
  const result = await activator.activate(
    makeSituation("Where is GET /health?", projectId),
    state,
    ["codebase", "invariants"]
  );

  const passed =
    result.contextSummary.includes("INNER_CONTEXT_MARKER") &&
    result.contextSummary.includes("Indexed codebase context") &&
    result.contextSummary.includes("/health") &&
    result.invariants.some((i) => i.rule === "INNER_INVARIANT_MARKER");

  return {
    name: "codebase-activation-inner-memory-preserved",
    passed,
    message: passed
      ? "inner contextSummary + invariants retained with codebase block"
      : `summary=${result.contextSummary.slice(0, 120)}`,
  };
}

export async function evalCodebaseActivationFailSoft(): Promise<EvalResult> {
  const projectId = randomUUID();
  const state = emptyProjectState(projectId, randomUUID(), "Eval");

  const inner: MemoryActivator = {
    activate: async () => ({
      decisions: [],
      invariants: [],
      risks: [],
      recentEvents: [],
      principles: [],
      contextSummary: "BASE_ONLY",
    }),
  };

  const reader = {
    search: async () => {
      throw new Error("postgres unavailable");
    },
    close: async () => {},
  } as unknown as CodebaseQueryReader;

  const activator = new CodebaseMemoryActivator(inner, reader, 50);

  try {
    const result = await activator.activate(makeSituation("GET /health route", projectId), state, [
      "codebase",
    ]);
    return {
      name: "codebase-activation-fail-soft-reader-error",
      passed:
        result.contextSummary === "BASE_ONLY" &&
        result.codebaseActivation?.reason === "error" &&
        result.codebaseActivation.activationUsed === false,
      message: `summary=${result.contextSummary} reason=${result.codebaseActivation?.reason}`,
    };
  } catch (err) {
    return {
      name: "codebase-activation-fail-soft-reader-error",
      passed: false,
      message: `threw: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export async function evalCodebaseActivationNoUserInputInBlock(): Promise<EvalResult> {
  const secretMarker = "sk-test-unit-leak-marker-9c4f2a";
  const block = formatCodebaseActivationBlock({
    query: secretMarker,
    files: [
      {
        id: randomUUID(),
        relativePath: "apps/api/src/index.ts",
        language: "typescript",
        lineCount: 42,
        contentHash: "abc123shouldnotappear",
        indexedAt: new Date().toISOString(),
      },
    ],
    routes: [],
    symbols: [],
    dependencies: [],
  });

  const passed =
    !block.includes(secretMarker) &&
    !block.includes("abc123shouldnotappear") &&
    !block.includes("Query terms") &&
    !block.includes("User asked") &&
    block.includes("apps/api/src/index.ts");

  return {
    name: "codebase-activation-block-no-user-input",
    passed,
    message: passed ? "block has paths only, no query/hash/user text" : block.slice(0, 200),
  };
}

export async function evalCodebaseActivationSanitizeTerms(): Promise<EvalResult> {
  const secret = "sk-e2e-sanitize-marker-abc123456789";
  const sanitized = sanitizeActivationSearchTerms(["/health", secret, "buildGateway"]);
  const passed =
    sanitized.includes("/health") &&
    sanitized.includes("buildGateway") &&
    !sanitized.some((t) => t.includes(secret));

  return {
    name: "codebase-activation-sanitize-search-terms",
    passed,
    message: `terms=${sanitized.join(",")}`,
  };
}

export async function evalCodebaseActivationTermBounds(): Promise<EvalResult> {
  const longTerm = "x".repeat(200);
  const manyTerms = Array.from({ length: 20 }, (_, i) => `term${i}`);
  const sanitized = sanitizeActivationSearchTerms([longTerm, ...manyTerms]);
  const maxLen = sanitized.reduce((m, t) => Math.max(m, t.length), 0);

  return {
    name: "codebase-activation-search-terms-bounded",
    passed: sanitized.length <= 10 && maxLen <= 80,
    message: `count=${sanitized.length} maxLen=${maxLen}`,
  };
}

export async function evalPublicActivationReportSafe(): Promise<EvalResult> {
  const { publicCodebaseActivationReport } = await import("@klm/core");
  const publicReport = publicCodebaseActivationReport({
    activationUsed: true,
    reason: "error",
    searchTerms: ["a".repeat(120)],
    counts: { files: 1, routes: 2, symbols: 3, dependencies: 4 },
  });
  const blob = JSON.stringify(publicReport);
  const passed =
    publicReport.searchTerms[0]!.length <= 80 &&
    !blob.includes("projectId") &&
    !blob.includes("stack") &&
    publicReport.reason === "error";

  return {
    name: "codebase-activation-public-report-safe",
    passed,
    message: `termLen=${publicReport.searchTerms[0]?.length}`,
  };
}

export async function runCodebaseActivatorEvals(): Promise<EvalResult[]> {
  return Promise.all([
    evalCodebaseActivationLimitCap(),
    evalCodebaseActivationLimitInvalid(),
    evalCodebaseActivationInnerMemoryPreserved(),
    evalCodebaseActivationFailSoft(),
    evalCodebaseActivationNoUserInputInBlock(),
    evalCodebaseActivationSanitizeTerms(),
    evalCodebaseActivationTermBounds(),
    evalPublicActivationReportSafe(),
  ]);
}
