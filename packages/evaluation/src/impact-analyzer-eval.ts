import { extractImpactSearchTerms, matchScore } from "@klm/impact-analyzer";
import { parseQueryLimit } from "@klm/codebase-indexer";
import type { EvalResult } from "./scenarios.js";

export function evalImpactLimitCap(): EvalResult {
  const capped = parseQueryLimit("5000");
  const passed = capped === 100;
  return {
    name: "impact-limit-cap-5000",
    passed,
    message: `parseQueryLimit(5000)=${capped}`,
  };
}

export function evalImpactTermExtraction(): EvalResult {
  const terms = extractImpactSearchTerms("queue panel drag gesture INV-FE-004");
  const passed =
    terms.some((t) => t.toLowerCase().includes("queue")) &&
    terms.some((t) => t.includes("INV-FE-004"));
  return {
    name: "impact-term-extraction",
    passed,
    message: terms.join(", "),
  };
}

export function evalImpactMatchScore(): EvalResult {
  const score = matchScore(["queue", "panel"], "frontend/QueuePanel.tsx");
  const passed = score > 0 && score <= 1;
  return {
    name: "impact-match-score",
    passed,
    message: `score=${score}`,
  };
}

export async function runImpactAnalyzerEvals(): Promise<EvalResult[]> {
  return [evalImpactTermExtraction(), evalImpactMatchScore(), evalImpactLimitCap()];
}
