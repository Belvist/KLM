import {
  computePlanVerdict,
  detectInvariantViolations,
  detectMissingSecurityTests,
  detectMissingTests,
  planMentionsTestCoverage,
} from "@klm/plan-verifier";
import type { ImpactAnalysisReport } from "@klm/core";
import type { EvalResult } from "./scenarios.js";

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

export function evalPlanGestureViolation(): EvalResult {
  const impact = stubImpact();
  const violations = detectInvariantViolations(
    "step 1: bypass gesturearbiter for faster drag".toLowerCase(),
    impact
  );
  const passed = violations.length > 0 && violations[0]!.severity === "hard";
  return {
    name: "plan-gesture-invariant-violation",
    passed,
    message: violations[0]?.message ?? "none",
  };
}

export function evalPlanVerdictBlocked(): EvalResult {
  const verdict = computePlanVerdict(
    [{ rule: "INV", message: "x", severity: "hard", source: "invariant" }],
    [],
    [],
    "high"
  );
  return {
    name: "plan-verdict-blocked-on-hard",
    passed: verdict === "blocked",
    message: verdict,
  };
}

export function evalPlanE2eDetection(): EvalResult {
  const impact = stubImpact();
  const missing = detectMissingTests(
    {
      steps: ["Update QueuePanel drag handler"],
      files: ["frontend/src/components/QueuePanel.tsx"],
    },
    impact
  );
  const withE2e = detectMissingTests(
    {
      steps: ["Update QueuePanel drag handler"],
      files: ["frontend/src/components/QueuePanel.tsx"],
      tests: ["Real-touch e2e for queue panel drag"],
    },
    impact
  );
  return {
    name: "plan-missing-e2e-detection",
    passed:
      missing.length > 0 &&
      withE2e.length === 0 &&
      planMentionsTestCoverage({ steps: ["x"], tests: ["e2e touch"] }),
    message: `missing=${missing.length} withE2e=${withE2e.length}`,
  };
}

export function evalPlanSecurityMissingTests(): EvalResult {
  const missing = detectMissingSecurityTests(
    { steps: ["Add auth middleware to /api/user routes"] },
    "add auth middleware to /api/user routes"
  );
  const withTests = detectMissingSecurityTests(
    {
      steps: ["Add auth middleware to /api/user routes"],
      tests: ["Integration test for 401 without token"],
    },
    "add auth middleware"
  );
  return {
    name: "plan-security-missing-tests",
    passed: missing.length > 0 && withTests.length === 0,
    message: missing[0] ?? "none",
  };
}

export function evalPlanSafeRequiresNoMissing(): EvalResult {
  const verdict = computePlanVerdict([], ["missing e2e"], [], "high");
  return {
    name: "plan-safe-blocked-by-missing-tests",
    passed: verdict === "needs_changes",
    message: verdict,
  };
}

export async function runPlanVerifierEvals(): Promise<EvalResult[]> {
  return [
    evalPlanGestureViolation(),
    evalPlanVerdictBlocked(),
    evalPlanE2eDetection(),
    evalPlanSecurityMissingTests(),
    evalPlanSafeRequiresNoMissing(),
  ];
}
