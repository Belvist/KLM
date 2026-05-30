import { redactSecretsInText } from "./redact-secrets.js";

export type ModelCallOutcome = "success" | "error";

const MAX_ERROR_MESSAGE_LEN = 500;
const MAX_ERROR_CODE_LEN = 64;

export function sanitizeModelCallError(err: unknown): {
  errorCode?: string;
  errorMessage: string;
} {
  let rawMessage: string;
  let rawCode: string | undefined;

  if (err instanceof Error) {
    rawMessage = err.message;
    const code = (err as Error & { code?: unknown }).code;
    if (code != null && code !== "") {
      rawCode = String(code);
    }
  } else {
    rawMessage = String(err);
  }

  const errorMessage = redactSecretsInText(rawMessage).slice(0, MAX_ERROR_MESSAGE_LEN);
  const errorCode = rawCode ? rawCode.slice(0, MAX_ERROR_CODE_LEN) : undefined;

  return { errorCode, errorMessage };
}
