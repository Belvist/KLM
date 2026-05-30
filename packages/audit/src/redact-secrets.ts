/** Patterns for common secret shapes in free text (prompts, events, chunks). */
const TEXT_SECRET_PATTERNS: RegExp[] = [
  /Bearer\s+\S+/gi,
  /sk-or-v1-[a-zA-Z0-9_-]+/gi,
  /sk-[a-zA-Z0-9]{20,}/gi,
  /(?:api[_-]?key|token|secret|password|authorization)\s*[:=]\s*\S+/gi,
  /OPENROUTER_API_KEY=\S+/gi,
  /OPENAI_API_KEY=\S+/gi,
];

export function redactSecretsInText(raw: string): string {
  let out = raw;
  for (const pattern of TEXT_SECRET_PATTERNS) {
    out = out.replace(pattern, "[redacted]");
  }
  return out;
}

const SENSITIVE_KEY = /key|secret|token|password|authorization|apikey/i;

export function redactAny(value: unknown, key = ""): unknown {
  if (SENSITIVE_KEY.test(key)) {
    return "[redacted]";
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactAny(item));
  }
  if (value && typeof value === "object") {
    return redactPayload(value as Record<string, unknown>);
  }
  return value;
}

export function redactPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    out[k] = redactAny(v, k);
  }
  return out;
}
