import type { ParsedIntent } from "@klm/core";
import { ParsedIntentSchema as IntentSchema } from "@klm/core";
import type { ModelRouter } from "@klm/model-adapters";

const INTENT_SYSTEM_PROMPT = `Classify the user request. Return JSON:
{
  "taskType": "code"|"architecture"|"document"|"debug"|"review"|"planning"|"question"|"refactor"|"unknown",
  "hiddenGoal": "optional inferred goal",
  "outputFormat": "code"|"architecture_doc"|"markdown"|"task_plan"|"explanation"|"mixed",
  "qualityLevel": "fast"|"balanced"|"production",
  "entities": ["extracted entities"],
  "urgency": "low"|"normal"|"high",
  "requiresVerification": true|false
}`;

export class IntentEngine {
  constructor(private router?: ModelRouter) {}

  async parse(rawInput: string): Promise<ParsedIntent> {
    if (this.router) {
      try {
        const response = await this.router.generate("intent", {
          messages: [
            { role: "system", content: INTENT_SYSTEM_PROMPT },
            { role: "user", content: rawInput },
          ],
          jsonMode: true,
          maxTokens: 512,
        });
        const parsed = JSON.parse(response.content);
        return IntentSchema.parse({ ...parsed, rawInput });
      } catch {
        // fall through to heuristic
      }
    }

    return this.heuristicParse(rawInput);
  }

  private heuristicParse(rawInput: string): ParsedIntent {
    const lower = rawInput.toLowerCase();

    let taskType: ParsedIntent["taskType"] = "unknown";
    if (/сделай|create|implement|build|endpoint|gateway|api/.test(lower)) taskType = "code";
    else if (/архитектур|architecture|design|schema/.test(lower)) taskType = "architecture";
    else if (/документ|document|readme|spec/.test(lower)) taskType = "document";
    else if (/баг|bug|fix|error|debug/.test(lower)) taskType = "debug";
    else if (/review|ревью|провер/.test(lower)) taskType = "review";
    else if (/plan|план|roadmap/.test(lower)) taskType = "planning";
    else if (/\?|что|как|why|how/.test(lower)) taskType = "question";

    let outputFormat: ParsedIntent["outputFormat"] = "explanation";
    if (taskType === "code") outputFormat = "mixed";
    else if (taskType === "architecture") outputFormat = "architecture_doc";
    else if (taskType === "document") outputFormat = "markdown";
    else if (taskType === "planning") outputFormat = "task_plan";

    const productionKeywords = /production|prod|enterprise|security|gateway|auth|billing/;
    const qualityLevel = productionKeywords.test(lower) ? "production" : "balanced";

    return IntentSchema.parse({
      rawInput,
      taskType,
      outputFormat,
      qualityLevel,
      entities: [],
      urgency: "normal",
      requiresVerification: taskType === "code" || taskType === "architecture",
    });
  }
}
