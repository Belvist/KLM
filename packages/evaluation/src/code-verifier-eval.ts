import {
  computeCodeVerdict,
  crossCheckPlanReport,
  detectInvariantViolations,
  detectWeakEvidence,
} from "@klm/code-verifier";
import type { ImpactAnalysisReport, PlanVerificationReport } from "@klm/core";
import { z } from "zod";
import type { EvalResult } from "./scenarios.js";

/** Mirrors MCP klm_verify_code args — legacy { content } must fail schema validation. */
const mcpCodeVerifyArgsSchema = z.object({
  task: z.string(),
  implementation: z.object({
    summary: z.string(),
    files: z.array(z.string()).optional(),
    routes: z.array(z.object({ httpMethod: z.string(), path: z.string() })).optional(),
    tests: z.array(z.string()).optional(),
  }),
  limit: z.number().int().min(1).max(100).optional(),
  planReport: z
    .object({
      verdict: z.enum(["safe", "needs_changes", "blocked"]),
      missingTests: z.array(z.string()).optional(),
      requiredChanges: z.array(z.string()).optional(),
    })
    .optional(),
});

function stubImpact(overrides: Partial<ImpactAnalysisReport> = {}): ImpactAnalysisReport {
  return {
    taskPreview: "queue panel",
    taskHash: "abc",
    searchTerms: ["queue"],
    affectedFiles: [{ path: "frontend/src/components/QueuePanel.tsx", score: 1 }],
    affectedRoutes: [],
    affectedSymbols: [
      { name: "QueuePanel", filePath: "frontend/src/components/QueuePanel.tsx", score: 1 },
    ],
    relatedInvariants: [
      {
        id: "00000000-0000-4000-8000-000000000001",
        rule: "INV-FE-004: Queue panel uses GestureArbiter for drag",
        severity: "hard",
        score: 1,
      },
    ],
    relatedDecisions: [],
    risks: [],
    suggestedTests: [{ kind: "e2e", description: "Real-touch e2e for queue panel drag" }],
    confidence: "high",
    metadataOnly: true,
    ...overrides,
  };
}

export function evalCodeGestureViolation(): EvalResult {
  const impact = stubImpact();
  const violations = detectInvariantViolations(
    "implemented bypass gesturearbiter for faster drag".toLowerCase(),
    impact
  );
  return {
    name: "code-gesture-invariant-violation",
    passed: violations.length > 0 && violations[0]!.severity === "hard",
    message: violations[0]?.message ?? "none",
  };
}

export function evalCodeVerdictBlocked(): EvalResult {
  const verdict = computeCodeVerdict(
    [{ rule: "INV", message: "x", severity: "hard", source: "invariant" }],
    [],
    [],
    [],
    [],
    { blocked: false, issues: [] },
    "high",
    { summary: "change queue panel drag handler" }
  );
  return {
    name: "code-verdict-blocked-on-hard",
    passed: verdict === "blocked",
    message: verdict,
  };
}

export function evalCodeWeakEvidenceNotPass(): EvalResult {
  const impact = stubImpact({ confidence: "low", affectedFiles: [] });
  const weak = detectWeakEvidence({ summary: "fix bug" }, impact);
  const verdict = computeCodeVerdict([], [], [], [], weak, { blocked: false, issues: [] }, "low", {
    summary: "fix bug",
  });
  return {
    name: "code-weak-evidence-not-pass",
    passed: weak.length > 0 && verdict === "needs_changes",
    message: `weak=${weak.length} verdict=${verdict}`,
  };
}

export function evalCodePlanBlockedCascade(): EvalResult {
  const planReport: PlanVerificationReport = {
    taskPreview: "t",
    taskHash: "h",
    planPreview: "p",
    planHash: "ph",
    verdict: "blocked",
    violations: [],
    missingTests: [],
    riskNotes: [],
    requiredChanges: [],
    confidence: "high",
    impactConfidence: "high",
    metadataOnly: true,
  };
  const cross = crossCheckPlanReport(
    { summary: "Implemented queue panel changes via GestureArbiter" },
    planReport
  );
  const verdict = computeCodeVerdict([], [], [], [], [], cross, "high", {
    summary: "Implemented queue panel changes via GestureArbiter",
  });
  return {
    name: "code-plan-blocked-cascade",
    passed: cross.blocked && verdict === "blocked",
    message: `blocked=${cross.blocked} verdict=${verdict}`,
  };
}

export function evalCodePassRequiresClean(): EvalResult {
  const verdict = computeCodeVerdict([], [], [], [], [], { blocked: false, issues: [] }, "high", {
    summary: "Hardened QueuePanel drag via GestureArbiter with real-touch e2e tests",
    files: ["frontend/src/components/QueuePanel.tsx"],
    tests: ["Real-touch e2e for queue panel drag"],
  });
  return {
    name: "code-pass-when-clean",
    passed: verdict === "pass",
    message: verdict,
  };
}

export function evalCodeLegacyContentInputRejected(): EvalResult {
  const legacy = { content: "endpoint without auth middleware" };
  const parsed = mcpCodeVerifyArgsSchema.safeParse(legacy);
  return {
    name: "code-legacy-content-input-rejected",
    passed: !parsed.success,
    message: parsed.success
      ? "legacy content accepted (must fail)"
      : "schema validation rejected legacy content",
  };
}

export async function runCodeVerifierEvals(): Promise<EvalResult[]> {
  return [
    evalCodeGestureViolation(),
    evalCodeVerdictBlocked(),
    evalCodeWeakEvidenceNotPass(),
    evalCodePlanBlockedCascade(),
    evalCodePassRequiresClean(),
    evalCodeLegacyContentInputRejected(),
  ];
}
