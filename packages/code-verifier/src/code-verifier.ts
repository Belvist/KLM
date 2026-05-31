import type {
  CodeImplementation,
  CodeVerificationBody,
  CodeVerificationReport,
  PlanVerificationReport,
} from "@klm/core";
import { CodeImplementationSchema, publicCodeVerificationReport } from "@klm/core";
import type { ImpactAnalyzer } from "@klm/impact-analyzer";
import {
  buildCodeSearchText,
  computeCodeConfidence,
  computeCodeVerdict,
  crossCheckPlanReport,
  detectCodeMissingTests,
  detectInvariantViolations,
  detectScopeDrift,
  detectSecurityRisks,
  detectWeakEvidence,
} from "./rules.js";

export interface CodeVerifyOptions {
  task: string;
  implementation: CodeImplementation;
  projectId: string;
  limit?: number;
  planReport?: PlanVerificationReport;
}

export class CodeVerifier {
  constructor(private impactAnalyzer: ImpactAnalyzer) {}

  async verify(options: CodeVerifyOptions): Promise<CodeVerificationReport> {
    const task = options.task.trim();
    const parsed = CodeImplementationSchema.parse(options.implementation);

    const impact = await this.impactAnalyzer.analyze({
      task,
      projectId: options.projectId,
      limit: options.limit,
    });

    const codeText = buildCodeSearchText(parsed);
    const violations = detectInvariantViolations(codeText, impact);
    const scopeDrift = detectScopeDrift(parsed, impact);
    const missingTests = detectCodeMissingTests(parsed, impact);
    const securityRisks = detectSecurityRisks(codeText, impact);
    const weakEvidence = detectWeakEvidence(parsed, impact);

    const planCrossCheck = options.planReport
      ? crossCheckPlanReport(parsed, options.planReport)
      : { blocked: false, issues: [] as string[] };

    const verdict = computeCodeVerdict(
      violations,
      missingTests,
      scopeDrift,
      securityRisks,
      weakEvidence,
      planCrossCheck,
      impact.confidence,
      parsed
    );
    const confidence = computeCodeConfidence(verdict, impact.confidence);

    const body: CodeVerificationBody = {
      verdict,
      violations,
      missingTests,
      securityRisks,
      scopeDrift: [...scopeDrift, ...weakEvidence, ...planCrossCheck.issues],
      confidence,
      impactConfidence: impact.confidence,
      planVerdict: options.planReport?.verdict,
      metadataOnly: true,
    };

    return publicCodeVerificationReport(task, parsed, body);
  }
}

export function parseCodeImplementation(raw: unknown): CodeImplementation {
  return CodeImplementationSchema.parse(raw);
}
