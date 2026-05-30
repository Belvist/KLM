import type {
  CandidateAction,
  Invariant,
  ProjectState,
  RankedAction,
  VerifiedAction,
} from "@klm/core";
import type { ModelRouter } from "@klm/model-adapters";

export { simulateFutures, rankActions, scoreAction, finalScore } from "./scorer.js";
export type { ActionScore } from "./scorer.js";

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
    projectState: ProjectState,
    scope?: { requestId?: string; projectId?: string }
  ): Promise<VerifiedAction> {
    const violations: VerifiedAction["violations"] = [];

    for (const invariant of invariants) {
      const violation = this.checkInvariant(action, invariant);
      if (violation) violations.push(violation);
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

    const criticalViolations = violations.filter((v) => v.severity === "critical" && !v.repaired);

    let repairedOutput: string | undefined;
    if (violations.length && this.router) {
      repairedOutput = await this.attemptRepair(action, violations, invariants, scope);
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

    if (
      decisionLower.includes("must not") &&
      approachLower.includes(decisionLower.replace("must not ", ""))
    ) {
      return `Approach may violate explicit prohibition`;
    }

    return null;
  }

  private async attemptRepair(
    action: RankedAction,
    violations: VerifiedAction["violations"],
    invariants: Invariant[],
    scope?: { requestId?: string; projectId?: string }
  ): Promise<string | undefined> {
    if (!this.router) return undefined;

    const response = await this.router.generate("verification", {
      messages: [
        {
          role: "system",
          content:
            "Fix the proposed action to satisfy all invariants. Return the corrected approach only.",
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
      requestId: scope?.requestId,
      projectId: scope?.projectId,
    });

    return response.content;
  }
}
