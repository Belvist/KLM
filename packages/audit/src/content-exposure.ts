import { createHash } from "node:crypto";

export const CONTENT_PREVIEW_MAX = 200;

export interface ContentExposureOptions {
  /** When true, include full `content` field (unless forceRedactContent). */
  includeContent: boolean;
  /** Env KLM_OBSERVABILITY_REDACT_CONTENT=true — never expose full content. */
  forceRedactContent: boolean;
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
  return { includeContent, forceRedactContent };
}

export function contentPreview(raw: string): string {
  if (raw.length <= CONTENT_PREVIEW_MAX) return raw;
  return `${raw.slice(0, CONTENT_PREVIEW_MAX)}…`;
}

export function contentHash(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function exposeTextContent(raw: string, opts: ContentExposureOptions): ExposedTextContent {
  const preview = contentPreview(raw);
  const base: ExposedTextContent = {
    contentPreview: preview,
    contentLength: raw.length,
    contentHash: contentHash(raw),
  };
  if (opts.includeContent && !opts.forceRedactContent) {
    return { ...base, content: raw };
  }
  return base;
}
