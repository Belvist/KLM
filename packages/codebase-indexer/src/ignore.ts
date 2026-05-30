export const DEFAULT_IGNORED_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  ".git",
  ".klm-data",
  "coverage",
  ".next",
  ".turbo",
  ".cache",
]);

export const DEFAULT_IGNORED_FILE_PATTERNS: ReadonlyArray<RegExp> = [
  /^\.env(\..*)?$/,
  /^\.npmrc$/,
  /^\.yarnrc$/,
  /^pnpm-debug\.log$/,
  /^npm-debug\.log$/,
  /^yarn-error\.log$/,
  /^id_rsa$/,
  /^id_ed25519$/,
  /.*\.pem$/,
  /.*\.key$/,
  /.*\.crt$/,
  /.*\.p12$/,
  /.*\.pfx$/,
  /^\.DS_Store$/,
];

export const DEFAULT_MAX_FILE_BYTES = 256 * 1024;

const BINARY_PROBE_BYTES = 8192;

export function resolveMaxFileBytes(): number {
  const raw = process.env.KLM_CODEBASE_MAX_FILE_BYTES;
  if (raw) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return DEFAULT_MAX_FILE_BYTES;
}

export function shouldIgnoreDirectory(dirName: string): boolean {
  return DEFAULT_IGNORED_DIRS.has(dirName);
}

export function shouldIgnoreFileName(baseName: string): boolean {
  return DEFAULT_IGNORED_FILE_PATTERNS.some((pattern) => pattern.test(baseName));
}

export function shouldIgnoreFile(relativePath: string): boolean {
  const base = relativePath.split(/[/\\]/).pop() ?? relativePath;
  if (shouldIgnoreFileName(base)) return true;
  if (relativePath.endsWith(".min.js") || relativePath.endsWith(".map")) return true;
  return false;
}

export function isIndexableSourceFile(relativePath: string): boolean {
  return /\.(tsx?|jsx?|mts|cts)$/i.test(relativePath);
}

/** True when buffer contains a NUL byte (common binary indicator). */
export function isBinaryBuffer(buffer: Buffer): boolean {
  if (buffer.length === 0) return false;

  let start = 0;
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    start = 3;
  }

  for (let i = start; i < buffer.length; i++) {
    if (buffer[i] === 0) {
      return true;
    }
  }

  return false;
}

export function binaryProbeByteCount(): number {
  return BINARY_PROBE_BYTES;
}
