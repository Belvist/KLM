import type {
  DecisionNode,
  ImpactAnalysisReport,
  ImpactConfidence,
  Invariant,
  RiskNode,
} from "@klm/core";
import { emptyImpactReport, MAX_IMPACT_ITEMS, publicImpactAnalysisReport } from "@klm/core";
import type {
  CodebaseQueryReader,
  CodeFileRow,
  CodeRouteRow,
  CodebaseSearchResult,
  CodeSymbolRow,
} from "@klm/codebase-indexer";
import { MAX_QUERY_LIMIT, parseQueryLimit } from "@klm/codebase-indexer";
import { extractImpactSearchTerms, matchScore, MAX_IMPACT_SEARCH_TERMS } from "./terms.js";
import { filterSafeImpactPaths, isSafeImpactPath } from "./safety.js";

export interface ImpactMemorySource {
  getInvariants(projectId: string): Promise<Invariant[]>;
  getDecisions(projectId: string): Promise<DecisionNode[]>;
  getRisks?(projectId: string): Promise<RiskNode[]>;
}

export interface ImpactAnalyzeOptions {
  task: string;
  projectId: string;
  limit?: number;
}

/** Minimum term overlap before an item is included in the impact report. */
const MIN_RANK_SCORE = 0.5;

function computeConfidence(
  terms: string[],
  fileCount: number,
  routeCount: number,
  symbolCount: number,
  invariantCount: number,
  decisionCount: number
): ImpactConfidence {
  if (!terms.length) return "low";
  const codebaseHits = fileCount + routeCount + symbolCount;
  const memoryHits = invariantCount + decisionCount;
  if (codebaseHits === 0 && memoryHits === 0) return "low";
  if (codebaseHits >= 3 || (codebaseHits >= 1 && memoryHits >= 1)) return "high";
  return "medium";
}

function rankFiles(terms: string[], files: CodeFileRow[]): ImpactAnalysisReport["affectedFiles"] {
  return filterSafeImpactPaths(
    files
      .map((f) => ({
        path: f.relativePath,
        language: f.language,
        score: matchScore(terms, `${f.relativePath} ${f.language ?? ""}`),
      }))
      .filter((f) => f.score >= MIN_RANK_SCORE && isSafeImpactPath(f.path))
      .sort((a, b) => b.score - a.score)
  );
}

function rankRoutes(
  terms: string[],
  routes: CodeRouteRow[]
): ImpactAnalysisReport["affectedRoutes"] {
  return filterSafeImpactPaths(
    routes
      .map((r) => ({
        httpMethod: r.httpMethod,
        path: r.path,
        filePath: r.filePath,
        score: matchScore(terms, `${r.httpMethod} ${r.path} ${r.filePath} ${r.handlerName ?? ""}`),
      }))
      .filter((r) => r.score >= MIN_RANK_SCORE && isSafeImpactPath(r.filePath))
      .sort((a, b) => b.score - a.score)
  );
}

function rankSymbols(
  terms: string[],
  symbols: CodeSymbolRow[]
): ImpactAnalysisReport["affectedSymbols"] {
  return filterSafeImpactPaths(
    symbols
      .map((s) => ({
        name: s.name,
        filePath: s.filePath,
        symbolType: s.symbolType,
        score: matchScore(terms, `${s.name} ${s.filePath} ${s.symbolType}`),
      }))
      .filter((s) => s.score >= MIN_RANK_SCORE && isSafeImpactPath(s.filePath))
      .sort((a, b) => b.score - a.score)
  );
}

function rankInvariants(
  terms: string[],
  invariants: Invariant[]
): ImpactAnalysisReport["relatedInvariants"] {
  return invariants
    .map((inv) => ({
      id: inv.id,
      rule: inv.rule,
      severity: inv.severity,
      score: matchScore(terms, `${inv.rule} ${inv.reason} ${inv.appliesTo.join(" ")}`),
    }))
    .filter((i) => i.score >= MIN_RANK_SCORE)
    .sort((a, b) => b.score - a.score);
}

function rankDecisions(
  terms: string[],
  decisions: DecisionNode[]
): ImpactAnalysisReport["relatedDecisions"] {
  return decisions
    .map((d) => ({
      id: d.id,
      decision: d.decision,
      score: matchScore(
        terms,
        `${d.decision} ${d.reason.join(" ")} ${d.linkedFiles.join(" ")} ${d.linkedModules.join(" ")}`
      ),
    }))
    .filter((d) => d.score >= MIN_RANK_SCORE)
    .sort((a, b) => b.score - a.score);
}

function buildRisks(
  relatedInvariants: ImpactAnalysisReport["relatedInvariants"],
  codebaseHitCount: number,
  storedRisks: RiskNode[]
): ImpactAnalysisReport["risks"] {
  const risks: ImpactAnalysisReport["risks"] = [];

  for (const inv of relatedInvariants.filter(
    (i) => i.severity === "critical" || i.severity === "hard"
  )) {
    risks.push({
      message: `Critical/hard invariant may apply: ${inv.rule.slice(0, 120)}`,
      severity: inv.severity === "critical" ? "critical" : "high",
      source: "invariant",
    });
  }

  for (const r of storedRisks.slice(0, 5)) {
    risks.push({
      message: r.title,
      severity: r.severity === "critical" ? "critical" : r.severity === "high" ? "high" : "medium",
      source: "coverage",
    });
  }

  if (codebaseHitCount === 0) {
    risks.push({
      message: "Insufficient indexed context for task — low confidence impact map",
      severity: "low",
      source: "coverage",
    });
  }

  return risks;
}

function buildSuggestedTests(
  files: ImpactAnalysisReport["affectedFiles"],
  routes: ImpactAnalysisReport["affectedRoutes"],
  symbols: ImpactAnalysisReport["affectedSymbols"],
  invariants: ImpactAnalysisReport["relatedInvariants"]
): ImpactAnalysisReport["suggestedTests"] {
  const tests: ImpactAnalysisReport["suggestedTests"] = [];

  const fePaths = files.filter((f) => /frontend|\.tsx|\.jsx|components/i.test(f.path));
  if (fePaths.length) {
    tests.push({
      kind: "e2e",
      description: `Real-touch e2e for affected frontend paths (${fePaths
        .slice(0, 3)
        .map((f) => f.path)
        .join(", ")})`,
    });
  }

  for (const route of routes.slice(0, 5)) {
    tests.push({
      kind: "integration",
      description: `HTTP ${route.httpMethod} ${route.path} regression test`,
    });
  }

  for (const sym of symbols.filter((s) => /gesture|queue|panel|modal/i.test(s.name)).slice(0, 3)) {
    tests.push({
      kind: "unit",
      description: `Unit tests for symbol ${sym.name} in ${sym.filePath}`,
    });
  }

  if (invariants.some((i) => /INV-FE/i.test(i.rule))) {
    tests.push({
      kind: "e2e",
      description: "Verify frontend invariants (GestureArbiter, touch-action, DeviceSyncContext)",
    });
  }

  if (!tests.length && files.length) {
    tests.push({
      kind: "manual",
      description: `Smoke-test changes in ${files[0]!.path}`,
    });
  }

  return tests;
}

/** Search per term and merge — DB ILIKE is single-phrase, impact tasks are multi-word. */
async function gatherIndexedHits(
  reader: CodebaseQueryReader,
  projectId: string,
  terms: string[],
  limit: number
): Promise<CodebaseSearchResult> {
  const files = new Map<string, CodeFileRow>();
  const routes = new Map<string, CodeRouteRow>();
  const symbols = new Map<string, CodeSymbolRow>();

  for (const term of terms.slice(0, MAX_IMPACT_SEARCH_TERMS)) {
    const hit = await reader.search({ projectId, query: term, limit });
    for (const f of hit.files) files.set(f.id, f);
    for (const r of hit.routes) routes.set(r.id, r);
    for (const s of hit.symbols) symbols.set(s.id, s);
  }

  return {
    query: terms.join(" "),
    files: [...files.values()],
    routes: [...routes.values()],
    symbols: [...symbols.values()],
    dependencies: [],
  };
}

export class ImpactAnalyzer {
  constructor(
    private reader: CodebaseQueryReader,
    private memory: ImpactMemorySource
  ) {}

  async analyze(options: ImpactAnalyzeOptions): Promise<ImpactAnalysisReport> {
    const task = options.task.trim();
    const limit = parseQueryLimit(
      options.limit != null ? String(Math.min(options.limit, MAX_QUERY_LIMIT)) : undefined
    );

    if (!task) {
      return publicImpactAnalysisReport(emptyImpactReport(""), limit);
    }

    const terms = extractImpactSearchTerms(task);
    if (!terms.length) {
      const report = emptyImpactReport(task);
      report.risks.push({
        message: "Could not extract searchable terms from task",
        severity: "low",
        source: "coverage",
      });
      return publicImpactAnalysisReport(report, limit);
    }

    const [search, invariants, decisions, risks] = await Promise.all([
      gatherIndexedHits(this.reader, options.projectId, terms, limit),
      this.memory.getInvariants(options.projectId),
      this.memory.getDecisions(options.projectId),
      this.memory.getRisks?.(options.projectId) ?? Promise.resolve([]),
    ]);

    const affectedFiles = rankFiles(terms, search.files).slice(0, MAX_IMPACT_ITEMS);
    const affectedRoutes = rankRoutes(terms, search.routes).slice(0, MAX_IMPACT_ITEMS);
    const affectedSymbols = rankSymbols(terms, search.symbols).slice(0, MAX_IMPACT_ITEMS);
    const relatedInvariants = rankInvariants(terms, invariants).slice(0, MAX_IMPACT_ITEMS);
    const relatedDecisions = rankDecisions(terms, decisions).slice(0, MAX_IMPACT_ITEMS);

    const codebaseHitCount = affectedFiles.length + affectedRoutes.length + affectedSymbols.length;

    const report: ImpactAnalysisReport = {
      task,
      searchTerms: terms,
      affectedFiles,
      affectedRoutes,
      affectedSymbols,
      relatedInvariants,
      relatedDecisions,
      risks: buildRisks(relatedInvariants, codebaseHitCount, risks),
      suggestedTests: buildSuggestedTests(
        affectedFiles,
        affectedRoutes,
        affectedSymbols,
        relatedInvariants
      ),
      confidence: computeConfidence(
        terms,
        affectedFiles.length,
        affectedRoutes.length,
        affectedSymbols.length,
        relatedInvariants.length,
        relatedDecisions.length
      ),
      metadataOnly: true,
    };

    return publicImpactAnalysisReport(report, limit);
  }
}
