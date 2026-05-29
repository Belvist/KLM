import type {
  CandidateAction,
  Invariant,
  ProjectState,
  RankedAction,
  VerifiedAction,
} from "@klm/core";
import type { ModelRouter } from "@klm/model-adapters";

export interface Verifier {
  verifyAndRepair(
    action: RankedAction,
    invariants: Invariant[],
    projectState: ProjectState
  ): Promise<VerifiedAction>;
}

export class CompositeVerifier implements Verifier {
  constructor(private router?: ModelRouter) {}

  async verifyAndRepair(
    action: RankedAction,
    invariants: Invariant[],
    projectState: ProjectState
  ): Promise<VerifiedAction> {
    const violations: VerifiedAction["violations"] = [];

    for (const invariant of invariants) {
      const violation = this.checkInvariant(action, invariant);
      if (violation) {
        violations.push(violation);
      }
    }

    for (const decision of projectState.decisions.filter((d) => d.status === "active")) {
      const conflict = this.checkDecisionConflict(action, decision.decision);
      if (conflict) {
        violations.push({
          rule: `Conflicts with decision: ${decision.decision}`,
          severity: "hard",
          message: conflict,
          repaired: false,
        });
      }
    }

    const criticalViolations = violations.filter(
      (v) => v.severity === "critical" && !v.repaired
    );

    let repairedOutput: string | undefined;
    if (violations.length && this.router) {
      repairedOutput = await this.attemptRepair(action, violations, invariants);
    }

    return {
      ...action,
      passed: criticalViolations.length === 0,
      violations,
      repairedOutput,
    };
  }

  private checkInvariant(
    action: CandidateAction,
    invariant: Invariant
  ): VerifiedAction["violations"][number] | null {
    const text = `${action.description} ${action.approach}`.toLowerCase();
    const rule = invariant.rule.toLowerCase();

    const authRequired = rule.includes("auth") && rule.includes("endpoint");
    if (authRequired && text.includes("endpoint") && !text.includes("auth")) {
      return {
        invariantId: invariant.id,
        rule: invariant.rule,
        severity: invariant.severity,
        message: `Action may violate invariant: ${invariant.rule}`,
        repaired: false,
      };
    }

    const rateLimitRequired = rule.includes("rate limit");
    if (rateLimitRequired && text.includes("public") && !text.includes("rate")) {
      return {
        invariantId: invariant.id,
        rule: invariant.rule,
        severity: invariant.severity,
        message: `Public endpoint without rate limit mentioned`,
        repaired: false,
      };
    }

    return null;
  }

  private checkDecisionConflict(action: CandidateAction, decision: string): string | null {
    const decisionLower = decision.toLowerCase();
    const approachLower = action.approach.toLowerCase();

    if (decisionLower.includes("centralized") && approachLower.includes("per-service")) {
      return `Approach contradicts centralized architecture decision`;
    }

    if (decisionLower.includes("must not") && approachLower.includes(decisionLower.replace("must not ", ""))) {
      return `Approach may violate explicit prohibition`;
    }

    return null;
  }

  private async attemptRepair(
    action: RankedAction,
    violations: VerifiedAction["violations"],
    invariants: Invariant[]
  ): Promise<string | undefined> {
    if (!this.router) return undefined;

    const response = await this.router.generate("verification", {
      messages: [
        {
          role: "system",
          content: "Fix the proposed action to satisfy all invariants. Return the corrected approach only.",
        },
        {
          role: "user",
          content: JSON.stringify({
            action,
            violations,
            invariants: invariants.map((i) => i.rule),
          }),
        },
      ],
      maxTokens: 2048,
    });

    return response.content;
  }
}

export function rankActions(
  actions: CandidateAction[],
  futures: Array<{ actionId: string; overallScore: number }>,
  weights: Record<string, number> = {
    goal_fit: 0.25,
    architecture_integrity: 0.2,
    security: 0.2,
    scalability: 0.1,
    simplicity: 0.1,
    future_stability: 0.1,
    cost: 0.05,
  }
): RankedAction[] {
  const futureMap = new Map(futures.map((f) => [f.actionId, f.overallScore]));

  const scored = actions.map((action) => {
    const baseScore = futureMap.get(action.id) ?? 0.5;
    const complexityPenalty =
      action.estimatedComplexity === "high" ? 0.1 : action.estimatedComplexity === "medium" ? 0.05 : 0;

    const scores: Record<string, number> = {};
    for (const [key, weight] of Object.entries(weights)) {
      scores[key] = baseScore * weight;
    }

    const totalScore = Object.values(scores).reduce((a, b) => a + b, 0) - complexityPenalty;

    return { ...action, totalScore, scores };
  });

  return scored
    .sort((a, b) => b.totalScore - a.totalScore)
    .map((action, index) => ({
      ...action,
      rank: index + 1,
    }));
}

export function simulateFutures(
  actions: CandidateAction[]
): import("@klm/core").SimulatedFuture[] {
  const scenarios = [
    { name: "user_growth", weight: 0.2 },
    { name: "security_attack", weight: 0.25 },
    { name: "new_service", weight: 0.2 },
    { name: "team_scaling", weight: 0.15 },
    { name: "api_change", weight: 0.2 },
  ];

  return actions.map((action) => {
    const complexityScore =
      action.estimatedComplexity === "high"
        ? 0.85
        : action.estimatedComplexity === "medium"
          ? 0.7
          : 0.5;

    const scenarioResults = scenarios.map((s) => ({
      name: s.name,
      outcome: `Under ${s.name}, ${action.approach}`,
      riskDelta: action.estimatedComplexity === "low" ? 0.3 : -0.1,
      score: complexityScore * s.weight * 5,
    }));

    const overallScore =
      scenarioResults.reduce((sum, s) => sum + s.score, 0) / scenarios.length;

    return {
      actionId: action.id,
      scenarios: scenarioResults,
      overallScore: Math.min(1, Math.max(0, overallScore)),
    };
  });
}
