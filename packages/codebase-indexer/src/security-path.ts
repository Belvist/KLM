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

function sqlExcludeDir(column: string, dir: string): string[] {
  return [`${column} NOT LIKE '${dir}/%'`, `${column} NOT LIKE '%/${dir}/%'`];
}

function sqlMatchDir(column: string, dir: string): string[] {
  return [`${column} LIKE '${dir}/%'`, `${column} LIKE '%/${dir}/%'`];
}

function buildIgnoredDirExcludeSql(column: string): string {
  const clauses: string[] = [];
  for (const dir of DEFAULT_IGNORED_DIRS) {
    for (const part of sqlExcludeDir(column, dir)) {
      clauses.push(`AND ${part}`);
    }
  }
  return clauses.join("\n  ");
}

function buildIgnoredDirMatchSql(column: string): string {
  const clauses: string[] = [];
  for (const dir of DEFAULT_IGNORED_DIRS) {
    for (const part of sqlMatchDir(column, dir)) {
      clauses.push(part);
    }
  }
  return clauses.join("\n       OR ");
}

const SECRET_PATH_EXCLUDE_SQL = `
  AND cf.relative_path !~ '(^|/)\\.env(\\.|$)'
  AND cf.relative_path !~ '(^|/)\\.npmrc$'
  AND cf.relative_path !~ '(^|/)\\.yarnrc$'
  AND cf.relative_path !~ '(^|/)id_rsa$'
  AND cf.relative_path !~ '(^|/)id_ed25519$'
  AND cf.relative_path !~ '\\.(pem|key|crt|p12|pfx)$'
`;

/** SQL fragment — alias \`cf\` must refer to code_files. Excludes nested and root-level ignored dirs. */
export const SAFE_CODE_FILE_PATH_SQL = `
  ${buildIgnoredDirExcludeSql("cf.relative_path")}
  ${SECRET_PATH_EXCLUDE_SQL}
`;

/** Positive match for ignored-dir paths (nested or root-level) on code_files.relative_path. */
export function ignoredDirPathMatchSql(column = "relative_path"): string {
  return buildIgnoredDirMatchSql(column);
}

export function filterSafePaths<T extends { relativePath?: string; filePath?: string }>(
  items: T[]
): T[] {
  return items.filter((item) => {
    const path = item.relativePath ?? item.filePath;
    return path ? isSafeQueryPath(path) : true;
  });
}
