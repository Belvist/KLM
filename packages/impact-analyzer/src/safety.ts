import { isSafeQueryPath } from "@klm/codebase-indexer";

const SECRET_PATH_MARKERS = [".env", ".npmrc", "id_rsa", "private.pem", "dist/leak", "build/leak"];

/** Defense-in-depth: drop unsafe paths even if present in DB fixtures. */
export function isSafeImpactPath(relativePath: string): boolean {
  if (!relativePath || !isSafeQueryPath(relativePath)) return false;
  const lower = relativePath.toLowerCase();
  return !SECRET_PATH_MARKERS.some((m) => lower.includes(m));
}

export function filterSafeImpactPaths<T extends { path?: string; filePath?: string }>(
  items: T[]
): T[] {
  return items.filter((item) => {
    const path = item.path ?? item.filePath ?? "";
    return isSafeImpactPath(path);
  });
}

/** Response must not echo raw task text or indexed content markers. */
export function responseExcludesSensitiveContent(
  json: string,
  forbiddenMarkers: string[]
): boolean {
  const lower = json.toLowerCase();
  if (lower.includes('"content"') || lower.includes('"contenthash"')) return false;
  if (/"task"\s*:/.test(json)) return false;
  for (const marker of forbiddenMarkers) {
    if (json.includes(marker)) return false;
  }
  return true;
}
