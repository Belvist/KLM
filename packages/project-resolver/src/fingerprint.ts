import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ProjectFingerprint } from "./types.js";

/** Normalize git remote URLs to host/org/repo (lowercase). */
export function normalizeGitRemote(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let url = trimmed.replace(/\.git$/i, "");

  const scp = url.match(/^git@([^:]+):(.+)$/);
  if (scp) {
    url = `${scp[1]}/${scp[2]}`;
  } else {
    url = url.replace(/^https?:\/\//i, "");
    url = url.replace(/^ssh:\/\//i, "");
  }

  url = url.replace(/\/+$/, "").toLowerCase();
  const parts = url.split("/").filter(Boolean);
  if (parts.length < 3) return null;

  const host = parts[0]!;
  const repo = parts.slice(-2).join("/");
  return `${host}/${repo}`;
}

export function readGitRemote(root: string): string | null {
  const gitDir = join(root, ".git");
  if (!existsSync(gitDir)) return null;

  try {
    const out = execSync("git remote get-url origin", {
      cwd: root,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return normalizeGitRemote(out);
  } catch {
    return null;
  }
}

export function rootPathHash(absPath: string): string {
  const normalized = resolve(absPath).replace(/\\/g, "/").toLowerCase();
  return createHash("sha256").update(`klm:path:v1:${normalized}`).digest("hex").slice(0, 32);
}

export function computeFingerprint(root: string): ProjectFingerprint {
  const abs = resolve(root);
  const gitRemote = readGitRemote(abs);
  const pathHash = rootPathHash(abs);

  const rootFingerprint = gitRemote ? `git:${gitRemote}` : `path:${pathHash}`;

  return { rootFingerprint, gitRemote, rootPathHash: pathHash };
}

/** Legacy stable UUID from path (used only when migrating old manifests). */
export function projectIdFromPath(absPath: string): string {
  const normalized = resolve(absPath).replace(/\\/g, "/").toLowerCase();
  const hash = createHash("sha256").update(`klm:project:v1:${normalized}`).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
