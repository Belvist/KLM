import type { CandidateAction, RankedAction, SimulatedFuture } from "@klm/core";
import type { ProjectState } from "@klm/core";

export interface ActionScore {
  goalFit: number;
  architectureIntegrity: number;
  security: number;
  scalability: number;
  simplicity: number;
  futureStability: number;
  cost: number;
  risk: number;
  complexityDebt: number;
}

const WEIGHTS = {
  goalFit: 0.2,
  architectureIntegrity: 0.2,
  security: 0.15,
  scalability: 0.15,
  futureStability: 0.15,
  simplicity: 0.1,
  cost: 0.1,
  risk: 0.2,
  complexityDebt: 0.15,
} as const;

function clamp(n: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, n));
}

function complexityDebt(action: CandidateAction): number {
  switch (action.estimatedComplexity) {
    case "high":
      return 0.85;
    case "medium":
      return 0.45;
    default:
      return 0.15;
  }
}

function securityScore(action: CandidateAction, projectState: ProjectState): number {
  const text = `${action.description} ${action.approach}`.toLowerCase();
  let score = 0.5;
  if (text.includes("auth")) score += 0.2;
  if (text.includes("rate limit") || text.includes("rate-limit")) score += 0.15;
  if (text.includes("audit")) score += 0.1;
  if (text.includes("minimal") && !text.includes("auth") && text.includes("endpoint")) {
    score -= 0.35;
  }
  const hardInvariants = projectState.invariants.filter((i) => i.severity === "hard" || i.severity === "critical");
  if (hardInvariants.length && action.estimatedComplexity === "low") {
    score -= 0.1;
  }
  return clamp(score);
}

export function scoreAction(
  action: CandidateAction,
  projectState: ProjectState,
  scenarioStability: number
): ActionScore {
  const debt = complexityDebt(action);
  const isProductionApproach = action.approach.toLowerCase().includes("production");

  return {
    goalFit: clamp(isProductionApproach ? 0.75 : action.estimatedComplexity === "low" ? 0.55 : 0.65),
    architectureIntegrity: clamp(
      action.affectedModules.length > 0 ? 0.7 : isProductionApproach ? 0.8 : 0.45
    ),
    security: securityScore(action, projectState),
    scalability: clamp(isProductionApproach ? 0.8 : action.estimatedComplexity === "high" ? 0.65 : 0.4),
    simplicity: clamp(1 - debt),
    futureStability: clamp(scenarioStability),
    cost: clamp(action.estimatedComplexity === "low" ? 0.2 : action.estimatedComplexity === "medium" ? 0.45 : 0.7),
    risk: clamp(debt * 0.6 + (isProductionApproach ? 0.1 : 0.35)),
    complexityDebt: debt,
  };
}

export function finalScore(s: ActionScore): number {
  return (
    s.goalFit * WEIGHTS.goalFit +
    s.architectureIntegrity * WEIGHTS.architectureIntegrity +
    s.security * WEIGHTS.security +
    s.scalability * WEIGHTS.scalability +
    s.futureStability * WEIGHTS.futureStability +
    s.simplicity * WEIGHTS.simplicity -
    s.cost * WEIGHTS.cost -
    s.risk * WEIGHTS.risk -
    s.complexityDebt * WEIGHTS.complexityDebt
  );
}

export function simulateFutures(
  actions: CandidateAction[],
  _projectState: ProjectState
): SimulatedFuture[] {
  const scenarios = [
    { name: "user_growth", stabilityImpact: 0.15 },
    { name: "security_attack", stabilityImpact: 0.25 },
    { name: "new_service", stabilityImpact: 0.2 },
    { name: "team_scaling", stabilityImpact: 0.15 },
    { name: "api_change", stabilityImpact: 0.25 },
  ];

  return actions.map((action) => {
    const debt = complexityDebt(action);
    const baseStability = clamp(0.75 - debt * 0.4);

    const scenarioResults = scenarios.map((s) => {
      const attackPenalty = s.name === "security_attack" && debt > 0.5 ? -0.25 : 0;
      const score = clamp(baseStability + s.stabilityImpact - debt * 0.2 + attackPenalty);
      return {
        name: s.name,
        outcome: `Under ${s.name}: ${action.approach}`,
        riskDelta: debt - (action.approach.includes("production") ? 0.15 : 0),
        score,
      };
    });

    const overallScore =
      scenarioResults.reduce((sum, r) => sum + r.score, 0) / scenarioResults.length;

    return {
      actionId: action.id,
      scenarios: scenarioResults,
      overallScore: clamp(overallScore),
    };
  });
}

export function rankActions(
  actions: CandidateAction[],
  futures: SimulatedFuture[],
  projectState: ProjectState
): RankedAction[] {
  const futureMap = new Map(futures.map((f) => [f.actionId, f.overallScore]));

  const scored = actions.map((action) => {
    const scenarioStability = futureMap.get(action.id) ?? 0.5;
    const dimensions = scoreAction(action, projectState, scenarioStability);
    const totalScore = finalScore(dimensions);

    return {
      ...action,
      totalScore,
      scores: dimensions as unknown as Record<string, number>,
    };
  });

  return scored
    .sort((a, b) => b.totalScore - a.totalScore)
    .map((action, index) => ({
      ...action,
      rank: index + 1,
    }));
}
