export type { AuditEntry, AuditLogger, ModelCallEntry } from "./types.js";
export { auditFromTenant } from "./types.js";
export { PostgresAuditLogger, ConsoleAuditLogger, CompositeAuditLogger } from "./postgres-audit.js";

import { PostgresAuditLogger, ConsoleAuditLogger, CompositeAuditLogger } from "./postgres-audit.js";
import type { AuditLogger } from "./types.js";

export function createAuditLogger(connectionString?: string): AuditLogger {
  const loggers: AuditLogger[] = [new ConsoleAuditLogger()];
  if (connectionString) {
    loggers.push(new PostgresAuditLogger(connectionString));
  }
  return new CompositeAuditLogger(loggers);
}

export { ObservabilityReader, parseLimit } from "./observability-reader.js";
export { redactPayload, redactSecretsInText, redactAny } from "./redact-secrets.js";
export {
  resolveContentExposure,
  exposeTextContent,
  contentPreview,
  contentHash,
  isForceRedactContent,
  CONTENT_PREVIEW_MAX,
  REDACTED_PREVIEW,
} from "./content-exposure.js";
export type {
  EventRow,
  ModelCallRow,
  AuditLogRow,
  MemoryChunkRow,
  PaginatedResult,
  PaginationParams,
} from "./observability-reader.js";
export { sanitizeModelCallError } from "./model-call-error.js";
export type { ModelCallOutcome } from "./model-call-error.js";
