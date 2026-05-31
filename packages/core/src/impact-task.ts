import { createHash } from "node:crypto";

/** Same secret shapes as observability redaction (@klm/audit). */
const TASK_SECRET_PATTERNS: RegExp[] = [
  /Bearer\s+\S+/gi,
  /sk-or-v1-[a-zA-Z0-9_-]+/gi,
  /sk-[a-zA-Z0-9_-]{8,}/gi,
  /(?:api[_-]?key|token|secret|password|authorization)\s*[:=]\s*\S+/gi,
  /OPENROUTER_API_KEY=\S+/gi,
  /OPENAI_API_KEY=\S+/gi,
];

export const MAX_IMPACT_TASK_PREVIEW = 240;

export function redactImpactTaskText(raw: string): string {
  let out = raw;
  for (const pattern of TASK_SECRET_PATTERNS) {
    out = out.replace(pattern, "[redacted]");
  }
  return out;
}

export function sanitizeImpactTaskPreview(raw: string): string {
  return redactImpactTaskText(raw.trim()).slice(0, MAX_IMPACT_TASK_PREVIEW);
}

export function hashImpactTask(raw: string): string {
  return createHash("sha256").update(raw.trim()).digest("hex");
}
