import { DEFAULT_IGNORED_DIRS, shouldIgnoreFile } from "./ignore.js";

/** Paths safe to expose via query API (indexed secret paths must never appear). */
export function isSafeQueryPath(relativePath: string): boolean {
  if (!relativePath || shouldIgnoreFile(relativePath)) return false;

  const segments = relativePath.split(/[/\\]/);
  for (const segment of segments) {
    if (DEFAULT_IGNORED_DIRS.has(segment)) return false;
  }

  return true;
}

/** SQL fragment — alias `cf` must refer to code_files. */
export const SAFE_CODE_FILE_PATH_SQL = `
  AND cf.relative_path NOT LIKE '%node_modules/%'
  AND cf.relative_path NOT LIKE '%/dist/%'
  AND cf.relative_path NOT LIKE '%/build/%'
  AND cf.relative_path NOT LIKE '%/.git/%'
  AND cf.relative_path NOT LIKE '%/.klm-data/%'
  AND cf.relative_path NOT LIKE '%/coverage/%'
  AND cf.relative_path NOT LIKE '%/.next/%'
  AND cf.relative_path NOT LIKE '%/.turbo/%'
  AND cf.relative_path NOT LIKE '%/.cache/%'
  AND cf.relative_path !~ '(^|/)\\.env(\\.|$)'
  AND cf.relative_path !~ '(^|/)\\.npmrc$'
  AND cf.relative_path !~ '(^|/)\\.yarnrc$'
  AND cf.relative_path !~ '(^|/)id_rsa$'
  AND cf.relative_path !~ '(^|/)id_ed25519$'
  AND cf.relative_path !~ '\\.(pem|key|crt|p12|pfx)$'
`;

export function filterSafePaths<T extends { relativePath?: string; filePath?: string }>(
  items: T[]
): T[] {
  return items.filter((item) => {
    const path = item.relativePath ?? item.filePath;
    return path ? isSafeQueryPath(path) : true;
  });
}
