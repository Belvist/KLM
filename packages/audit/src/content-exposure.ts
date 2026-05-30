import { createHash } from "node:crypto";
import { redactSecretsInText } from "./redact-secrets.js";

export const CONTENT_PREVIEW_MAX = 200;
export const REDACTED_PREVIEW = "[redacted]";

export interface ContentExposureOptions {
  /** When true, include full `content` field (unless forceRedactContent). */
  includeContent: boolean;
  /** Env KLM_OBSERVABILITY_REDACT_CONTENT=true — never expose full content or raw preview. */
  forceRedactContent: boolean;
  /** When true, contentPreview is `[redacted]` (derived from forceRedactContent). */
  redactPreview: boolean;
}

export interface ExposedTextContent {
  content?: string;
  contentPreview: string;
  contentLength: number;
  contentHash: string;
}

export function isForceRedactContent(): boolean {
  return process.env.KLM_OBSERVABILITY_REDACT_CONTENT === "true";
}

/** Parse ?includeContent=true; default false. Env force-redact overrides. */
export function resolveContentExposure(queryIncludeContent?: string): ContentExposureOptions {
  const forceRedactContent = isForceRedactContent();
  const includeContent = !forceRedactContent && queryIncludeContent === "true";
  return {
    includeContent,
    forceRedactContent,
    redactPreview: forceRedactContent,
  };
}

export function contentPreview(raw: string): string {
  const sanitized = redactSecretsInText(raw);
  if (sanitized.length <= CONTENT_PREVIEW_MAX) return sanitized;
  return `${sanitized.slice(0, CONTENT_PREVIEW_MAX)}…`;
}

export function contentHash(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function exposeTextContent(raw: string, opts: ContentExposureOptions): ExposedTextContent {
  const safePreview =
    opts.forceRedactContent || opts.redactPreview ? REDACTED_PREVIEW : contentPreview(raw);

  const base: ExposedTextContent = {
    contentPreview: safePreview,
    contentLength: raw.length,
    contentHash: contentHash(raw),
  };

  if (opts.includeContent && !opts.forceRedactContent) {
    return { ...base, content: redactSecretsInText(raw) };
  }

  return base;
}
