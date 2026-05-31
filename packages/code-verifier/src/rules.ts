import type {
  CodeImplementation,
  ImpactAnalysisReport,
  ImpactConfidence,
  PlanVerificationReport,
} from "@klm/core";
import type { PlanInvariantCheck } from "@klm/plan-verifier";
import {
  collectRiskNotes,
  detectInvariantViolations,
  detectMissingSecurityTests,
  detectMissingTests,
  detectOutOfScopeFiles,
  planMentionsTestCoverage,
} from "@klm/plan-verifier";

export function buildCodeSearchText(impl: CodeImplementation): string {
  const parts: string[] = [impl.summary];
  for (const f of impl.files ?? []) parts.push(f);
  for (const r of impl.routes ?? []) parts.push(`${r.httpMethod} ${r.path}`);
  for (const t of impl.tests ?? []) parts.push(t);
  return parts.join("\n").toLowerCase();
}

export function implementationAsPlan(impl: CodeImplementation) {
  return {
    steps: [impl.summary],
    files: impl.files,
    routes: impl.routes,
    tests: impl.tests,
  };
}

export function detectScopeDrift(impl: CodeImplementation, impact: ImpactAnalysisReport): string[] {
  return detectOutOfScopeFiles(implementationAsPlan(impl), impact);
}

export function detectSecurityRisks(codeText: string, impact: ImpactAnalysisReport): string[] {
  const risks: string[] = [];

  if (
    /no auth|without auth|unauthenticated|public endpoint|skip auth|bypass auth/i.test(codeText)
  ) {
    risks.push("Implementation may expose unauthenticated access");
  }
  if (/client.?projectid|body\.projectid|trust client project/i.test(codeText)) {
    risks.push("Implementation may trust client-supplied projectId");
  }
  if (/eval\(|innerhtml\s*=|dangerouslysetinnerhtml/i.test(codeText)) {
    risks.push("Potential XSS or code injection pattern detected");
  }

  for (const note of collectRiskNotes(impact)) {
    if (!risks.includes(note)) risks.push(note);
  }

  return risks.slice(0, 20);
}

export function detectWeakEvidence(
  impl: CodeImplementation,
  impact: ImpactAnalysisReport
): string[] {
  const issues: string[] = [];
  const summary = impl.summary.trim();

  if (summary.length < 24) {
    issues.push("Implementation summary too short for reliable verification");
  }
  if (!impl.files?.length && impact.affectedFiles.length > 0) {
    issues.push("No touched files listed — cannot confirm scope against impact");
  }
  if (impact.confidence === "low" && impact.affectedFiles.length === 0) {
    issues.push("Insufficient impact context — refine task or re-index codebase");
  }
  return issues;
}

export interface PlanCrossCheckResult {
  issues: string[];
  blocked: boolean;
}

/** Cross-check implementation against an optional prior plan verification report. */
export function crossCheckPlanReport(
  impl: CodeImplementation,
  planReport: PlanVerificationReport
): PlanCrossCheckResult {
  const issues: string[] = [];

  if (planReport.verdict === "blocked") {
    return {
      blocked: true,
      issues: ["Prior plan verification was blocked — code must not proceed"],
    };
  }

  if (planReport.verdict === "needs_changes") {
    issues.push("Prior plan verification required changes not yet addressed");
  }

  for (const missing of planReport.missingTests) {
    const codeText = buildCodeSearchText(impl);
    const keyword = missing.split(/\s+/).find((w) => w.length > 5);
    if (
      keyword &&
      !codeText.includes(keyword.toLowerCase()) &&
      !planMentionsTestCoverage(implementationAsPlan(impl))
    ) {
      issues.push(`Plan required test coverage missing in implementation: ${missing}`);
    }
  }

  for (const change of planReport.requiredChanges) {
    issues.push(`Unresolved plan requirement: ${change}`);
  }

  return { blocked: false, issues: issues.slice(0, 20) };
}

export function computeCodeVerdict(
  violations: PlanInvariantCheck[],
  missingTests: string[],
  scopeDrift: string[],
  securityRisks: string[],
  weakEvidence: string[],
  planCrossCheck: PlanCrossCheckResult,
  impactConfidence: ImpactConfidence,
  impl: CodeImplementation
): "pass" | "needs_changes" | "blocked" {
  if (planCrossCheck.blocked) return "blocked";
  if (violations.some((v) => v.severity === "critical" || v.severity === "hard")) {
    return "blocked";
  }

  const codeText = buildCodeSearchText(impl);
  const touchesSecurity = /auth|tenant|session|security|403|middleware|bearer|api key/i.test(
    codeText
  );
  if (touchesSecurity && !planMentionsTestCoverage(implementationAsPlan(impl))) {
    return "needs_changes";
  }

  if (
    missingTests.length ||
    scopeDrift.length ||
    violations.length ||
    weakEvidence.length ||
    planCrossCheck.issues.length ||
    securityRisks.some((r) => /unauthenticated|trust client|injection/i.test(r))
  ) {
    return "needs_changes";
  }

  if (impactConfidence === "low") {
    return "needs_changes";
  }

  return "pass";
}

export function computeCodeConfidence(
  verdict: "pass" | "needs_changes" | "blocked",
  impactConfidence: ImpactConfidence
): ImpactConfidence {
  if (verdict === "blocked") return impactConfidence === "high" ? "high" : "medium";
  if (verdict === "needs_changes") return impactConfidence === "low" ? "low" : "medium";
  return impactConfidence;
}

export function detectCodeMissingTests(
  impl: CodeImplementation,
  impact: ImpactAnalysisReport
): string[] {
  const plan = implementationAsPlan(impl);
  const missing = detectMissingTests(plan, impact);
  missing.push(...detectMissingSecurityTests(plan, buildCodeSearchText(impl)));
  return [...new Set(missing)].slice(0, 20);
}

export { detectInvariantViolations, type PlanInvariantCheck };
