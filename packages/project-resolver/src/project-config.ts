import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { KlmProjectManifest } from "./types.js";

export const KLM_DIR = ".klm";
export const MANIFEST_FILE = "project.json";

const GITIGNORE_KLM_PATTERNS = [".klm", ".klm/", "/.klm", "/.klm/"];

export function manifestPath(workspaceRoot: string): string {
  return join(resolve(workspaceRoot), KLM_DIR, MANIFEST_FILE);
}

export function readManifest(workspaceRoot: string): KlmProjectManifest | null {
  const path = manifestPath(workspaceRoot);
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as KlmProjectManifest;
    if (!raw.projectId || !raw.rootPath) return null;
    return raw;
  } catch {
    return null;
  }
}

export function writeManifest(workspaceRoot: string, manifest: KlmProjectManifest): void {
  const dir = join(resolve(workspaceRoot), KLM_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(manifestPath(workspaceRoot), `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
}

/** Walk up from startDir to find directory containing .klm/project.json */
export function findProjectRoot(startDir: string): string | null {
  let dir = resolve(startDir);
  for (;;) {
    if (existsSync(manifestPath(dir))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function defaultProjectName(root: string): string {
  return basename(resolve(root));
}

/** Count .klm gitignore entries (for idempotency checks). */
export function countGitignoreKlmEntries(content: string): number {
  return content.split("\n").filter((line) => {
    const t = line.trim();
    return GITIGNORE_KLM_PATTERNS.includes(t);
  }).length;
}

export function hasGitignoreKlm(content: string): boolean {
  return countGitignoreKlmEntries(content) > 0;
}

/**
 * Ensure `.klm/` is in .gitignore — append-only, never overwrite existing file content.
 * Creates .gitignore if missing.
 */
export function ensureGitignoreKlm(root: string): { created: boolean; appended: boolean } {
  const gitignorePath = join(resolve(root), ".gitignore");
  const entry = ".klm/";

  if (!existsSync(gitignorePath)) {
    writeFileSync(
      gitignorePath,
      `# KLM local project identity (dev)\n${entry}\n`,
      "utf-8"
    );
    return { created: true, appended: false };
  }

  const content = readFileSync(gitignorePath, "utf-8");
  if (hasGitignoreKlm(content)) {
    return { created: false, appended: false };
  }

  const needsNewline = content.length > 0 && !content.endsWith("\n");
  const block = `${needsNewline ? "\n" : ""}\n# KLM local project identity (dev)\n${entry}\n`;
  writeFileSync(gitignorePath, `${content}${block}`, "utf-8");
  return { created: false, appended: true };
}

const FORBIDDEN_MANIFEST_KEYS = [
  "database_url",
  "databaseurl",
  "api_key",
  "apikey",
  "openrouter",
  "secret",
  "password",
  "token",
  "private_key",
];

/** Returns forbidden key names found in manifest JSON (case-insensitive). */
export function findForbiddenManifestKeys(manifest: Record<string, unknown>): string[] {
  const found: string[] = [];
  for (const key of Object.keys(manifest)) {
    const lower = key.toLowerCase();
    if (FORBIDDEN_MANIFEST_KEYS.some((f) => lower.includes(f))) {
      found.push(key);
    }
    const val = manifest[key];
    if (typeof val === "string" && /postgresql:\/\//i.test(val)) {
      found.push(key);
    }
  }
  return found;
}
