import type {
  CompiledOutput,
  OutputFormat,
  ParsedIntent,
  ProjectState,
  VerifiedAction,
} from "@klm/core";
import type { ModelRouter } from "@klm/model-adapters";

export interface CompileParams {
  verifiedAction: VerifiedAction;
  outputType: OutputFormat;
  intent: ParsedIntent;
  projectState: ProjectState;
  memoryContext: string;
  requestId?: string;
  projectId?: string;
}

export class RealityCompiler {
  constructor(private router: ModelRouter) {}

  async compile(params: CompileParams): Promise<CompiledOutput> {
    let fullContent = "";
    for await (const chunk of this.compileStream(params)) {
      fullContent += chunk;
    }
    const artifacts = this.extractArtifacts(fullContent);
    return {
      type: params.outputType,
      content: fullContent,
      artifacts,
      warnings: params.verifiedAction.violations.filter((v) => !v.repaired).map((v) => v.message),
      implementationPlan:
        params.intent.qualityLevel === "production"
          ? [
              "Review generated architecture",
              "Run tests",
              "Apply migrations",
              "Deploy with observability",
              "Update project memory",
            ]
          : undefined,
    };
  }

  /**
   * Streams the same model output that compile() would produce (single generation pass).
   */
  async *compileStream(params: CompileParams): AsyncIterable<string> {
    const taskType =
      params.outputType === "code" || params.outputType === "mixed"
        ? "codegen"
        : params.intent.taskType === "architecture"
          ? "planning"
          : "general";

    const systemPrompt = this.buildSystemPrompt(params);
    const userContent = [
      `Task: ${params.intent.rawInput}`,
      `Approach: ${params.verifiedAction.repairedOutput ?? params.verifiedAction.approach}`,
      params.memoryContext ? `\nProject memory:\n${params.memoryContext}` : "",
      params.verifiedAction.violations.length
        ? `\nAddress these violations:\n${params.verifiedAction.violations.map((v) => v.message).join("\n")}`
        : "",
    ].join("\n");

    for await (const chunk of this.router.stream(taskType, {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      maxTokens: 8192,
      stream: true,
      jsonMode: false,
      requestId: params.requestId,
      projectId: params.projectId,
    })) {
      if (chunk.content) {
        yield chunk.content;
      }
    }
  }

  private buildSystemPrompt(params: {
    outputType: OutputFormat;
    intent: ParsedIntent;
    projectState: ProjectState;
  }): string {
    const parts = [
      "You are KLM Runtime — a stateful project intelligence system.",
      "The model is a replaceable compute module. Project memory, decisions, and invariants are authoritative.",
      `Quality level: ${params.intent.qualityLevel}`,
      `Output format: ${params.outputType}`,
    ];

    if (params.intent.qualityLevel === "production") {
      parts.push(
        "For production tasks include: architecture rationale, file structure, code, tests, configs, observability, security controls."
      );
    }

    if (params.projectState.invariants.length) {
      parts.push(
        "Must satisfy invariants:\n" +
          params.projectState.invariants.map((i) => `- [${i.severity}] ${i.rule}`).join("\n")
      );
    }

    return parts.join("\n");
  }

  private extractArtifacts(content: string): CompiledOutput["artifacts"] {
    const artifacts: CompiledOutput["artifacts"] = [];
    const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
    let match: RegExpExecArray | null;
    let index = 0;

    while ((match = codeBlockRegex.exec(content)) !== null) {
      const lang = match[1] ?? "txt";
      artifacts.push({
        path: `artifact_${index++}.${lang === "typescript" ? "ts" : lang}`,
        content: match[2].trim(),
        kind: lang === "sql" ? "migration" : lang.includes("test") ? "test" : "code",
      });
    }

    return artifacts;
  }
}
