import type { ImpactAnalysisReport, ImplementationPlan } from "@klm/core";

export function buildPlanSearchText(plan: ImplementationPlan): string {
  const parts: string[] = [...plan.steps];
  for (const f of plan.files ?? []) parts.push(f);
  for (const r of plan.routes ?? []) parts.push(`${r.httpMethod} ${r.path}`);
  for (const t of plan.tests ?? []) parts.push(t);
  return parts.join("\n").toLowerCase();
}

export function planMentionsTestCoverage(plan: ImplementationPlan): boolean {
  const text = buildPlanSearchText(plan);
  return /\be2e\b|real-touch|touch-action|playwright|cypress|gesture.*test|integration test|unit test|manual validation|manual test|smoke test|regression test/i.test(
    text
  );
}

/** @deprecated use planMentionsTestCoverage */
export function planMentionsE2e(plan: ImplementationPlan): boolean {
  return planMentionsTestCoverage(plan);
}

export function pathMatchesScope(planPath: string, impactPath: string): boolean {
  const norm = (p: string) => p.replace(/\\/g, "/").toLowerCase();
  const a = norm(planPath);
  const b = norm(impactPath);
  if (a === b || a.endsWith(b) || b.endsWith(a)) return true;
  const aBase = a.split("/").pop() ?? a;
  const bBase = b.split("/").pop() ?? b;
  return aBase === bBase || a.includes(bBase) || b.includes(aBase);
}

export interface PlanInvariantCheck {
  rule: string;
  message: string;
  severity: "soft" | "hard" | "critical";
  source: "invariant" | "decision" | "scope" | "coverage";
}

/** Rule-based invariant conflict detection (deterministic, no LLM). */
export function detectInvariantViolations(
  planText: string,
  impact: ImpactAnalysisReport
): PlanInvariantCheck[] {
  const violations: PlanInvariantCheck[] = [];

  for (const inv of impact.relatedInvariants) {
    const rule = inv.rule.toLowerCase();

    if (/gesturearbiter|gesture arbiter/i.test(inv.rule)) {
      if (/bypass|skip|remove|without|disable.*gesture|no gesture/i.test(planText)) {
        violations.push({
          rule: inv.rule,
          message: "Plan bypasses or removes GestureArbiter — conflicts with frontend invariant",
          severity: inv.severity === "critical" ? "critical" : "hard",
          source: "invariant",
        });
      }
    }

    if (/devicesynccontext|device sync context/i.test(inv.rule)) {
      if (/local state only|bypass sync|ignore sync|without devicesync/i.test(planText)) {
        violations.push({
          rule: inv.rule,
          message: "Plan bypasses DeviceSyncContext ownership",
          severity: inv.severity === "critical" ? "critical" : "hard",
          source: "invariant",
        });
      }
    }

    if (rule.includes("auth") && (rule.includes("endpoint") || rule.includes("api"))) {
      if (
        /no auth|without auth|unauthenticated|public endpoint|skip auth|bypass auth/i.test(planText)
      ) {
        violations.push({
          rule: inv.rule,
          message: "Plan proposes unauthenticated endpoint access",
          severity: "critical",
          source: "invariant",
        });
      }
    }

    if (/tenant|project.?id|x-klm-project/i.test(inv.rule)) {
      if (/client projectid|body projectid|trust client project/i.test(planText)) {
        violations.push({
          rule: inv.rule,
          message: "Plan may trust client-supplied projectId instead of tenant header",
          severity: "hard",
          source: "invariant",
        });
      }
    }
  }

  for (const dec of impact.relatedDecisions) {
    const decision = dec.decision.toLowerCase();
    if (
      decision.includes("centralized auth") &&
      /per-service auth|local auth only/i.test(planText)
    ) {
      violations.push({
        rule: dec.decision,
        message: "Plan contradicts centralized auth decision",
        severity: "hard",
        source: "decision",
      });
    }
  }

  return violations;
}

export function detectOutOfScopeFiles(
  plan: ImplementationPlan,
  impact: ImpactAnalysisReport
): string[] {
  const planFiles = plan.files ?? [];
  if (!planFiles.length || !impact.affectedFiles.length) return [];

  const out: string[] = [];
  for (const pf of planFiles) {
    const inScope = impact.affectedFiles.some((af) => pathMatchesScope(pf, af.path));
    if (!inScope) out.push(pf);
  }
  return out;
}

export function detectMissingTests(
  plan: ImplementationPlan,
  impact: ImpactAnalysisReport
): string[] {
  const missing: string[] = [];
  const planText = buildPlanSearchText(plan);
  const touchesGesture =
    /gesture|drag|pointer|touch|queue panel|frontend/i.test(planText) ||
    impact.affectedSymbols.some((s) => /gesture|queue|panel/i.test(s.name));

  const needsE2e =
    touchesGesture &&
    (impact.relatedInvariants.some((i) => /INV-FE|real-touch|e2e/i.test(i.rule)) ||
      impact.suggestedTests.some((t) => t.kind === "e2e"));

  if (needsE2e && !planMentionsTestCoverage(plan)) {
    missing.push("Real-touch or frontend e2e tests required for gesture/queue changes (INV-FE)");
  }

  for (const suggested of impact.suggestedTests) {
    if (suggested.kind !== "e2e") continue;
    const keyword = suggested.description.split(/\s+/).find((w) => w.length > 5);
    if (keyword && !planText.includes(keyword.toLowerCase()) && !planMentionsTestCoverage(plan)) {
      missing.push(suggested.description);
    }
  }

  missing.push(...detectMissingSecurityTests(plan, planText));

  return [...new Set(missing)].slice(0, 20);
}

/** Auth/tenant/security plan changes require explicit validation coverage. */
export function detectMissingSecurityTests(plan: ImplementationPlan, planText: string): string[] {
  const touchesSecurity =
    /auth|tenant|session|security|403|projectid|middleware|bearer|api key/i.test(planText) ||
    (plan.routes?.length ?? 0) > 0;

  if (touchesSecurity && !planMentionsTestCoverage(plan)) {
    return ["Security/auth/tenant changes require explicit tests or manual validation in plan"];
  }
  return [];
}

export function collectRiskNotes(impact: ImpactAnalysisReport): string[] {
  return impact.risks
    .filter((r) => r.severity === "high" || r.severity === "critical")
    .map((r) => r.message)
    .slice(0, 10);
}

export function computePlanVerdict(
  violations: PlanInvariantCheck[],
  missingTests: string[],
  requiredChanges: string[],
  impactConfidence: ImpactAnalysisReport["confidence"]
): "safe" | "needs_changes" | "blocked" {
  if (violations.some((v) => v.severity === "critical" || v.severity === "hard")) {
    return "blocked";
  }
  if (missingTests.length || requiredChanges.length || violations.length) {
    return "needs_changes";
  }
  if (impactConfidence === "low") {
    return "needs_changes";
  }
  return "safe";
}

export function computePlanConfidence(
  verdict: "safe" | "needs_changes" | "blocked",
  impactConfidence: ImpactAnalysisReport["confidence"]
): ImpactAnalysisReport["confidence"] {
  if (verdict === "blocked") return impactConfidence === "high" ? "high" : "medium";
  if (verdict === "needs_changes") return impactConfidence === "low" ? "low" : "medium";
  return impactConfidence;
}
