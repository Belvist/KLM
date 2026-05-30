import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  computeFingerprint,
  countGitignoreKlmEntries,
  ensureGitignoreKlm,
  findForbiddenManifestKeys,
  initProject,
  McpWorkspaceRootError,
  normalizeGitRemote,
  ProjectFingerprintMismatchError,
  ProjectNotInitializedError,
  readManifest,
  resolveForCli,
  resolveForMcp,
  resolveProjectIdForRoot,
} from "@klm/project-resolver";
import type { EvalResult } from "./scenarios.js";

export function evalGitRemoteNormalization(): EvalResult {
  const ssh = normalizeGitRemote("git@github.com:Belvist/KLM.git");
  const https = normalizeGitRemote("https://github.com/Belvist/KLM.git");
  const passed = ssh === "github.com/belvist/klm" && https === ssh;

  return {
    name: "project-resolver-git-remote-normalization",
    passed,
    message: passed ? `both → ${ssh}` : `ssh=${ssh} https=${https}`,
  };
}

export function evalFingerprintStable(): EvalResult {
  const dir = mkdtempSync(join(tmpdir(), "klm-fp-"));
  try {
    const a = computeFingerprint(dir);
    const b = computeFingerprint(dir);
    const passed = a.rootFingerprint === b.rootFingerprint && a.rootFingerprint.startsWith("path:");
    return {
      name: "project-resolver-fingerprint-stable",
      passed,
      message: a.rootFingerprint,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function evalManifestNoSecrets(): EvalResult {
  const forbidden = findForbiddenManifestKeys({
    projectId: "00000000-0000-4000-8000-000000000001",
    DATABASE_URL: "postgresql://klm:klm@localhost/klm",
    OPENROUTER_API_KEY: "sk-test",
  });
  const safe = findForbiddenManifestKeys({
    projectId: "00000000-0000-4000-8000-000000000001",
    name: "demo",
    rootFingerprint: "path:abc",
  });
  const passed = forbidden.length >= 2 && safe.length === 0;
  return {
    name: "project-resolver-manifest-no-secrets",
    passed,
    message: passed ? `blocked=${forbidden.length}` : `forbidden=${forbidden.join(",")}`,
  };
}

export async function evalInitIdempotent(): Promise<EvalResult> {
  const dir = mkdtempSync(join(tmpdir(), "klm-init-"));
  try {
    const first = await initProject({ root: dir });
    const second = await initProject({ root: dir });
    const passed =
      first.manifest.projectId === second.manifest.projectId &&
      second.created === false &&
      readManifest(dir)?.projectId === first.manifest.projectId;

    return {
      name: "project-resolver-init-idempotent",
      passed,
      message: passed
        ? `stable id ${first.manifest.projectId}`
        : `first=${first.manifest.projectId} second=${second.manifest.projectId}`,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function evalGitignoreNoDuplicate(): Promise<EvalResult> {
  const dir = mkdtempSync(join(tmpdir(), "klm-gi-"));
  try {
    await initProject({ root: dir });
    const afterFirst = readFileSync(join(dir, ".gitignore"), "utf-8");
    const countFirst = countGitignoreKlmEntries(afterFirst);

    await initProject({ root: dir });
    const afterSecond = readFileSync(join(dir, ".gitignore"), "utf-8");
    const countSecond = countGitignoreKlmEntries(afterSecond);

    const passed = countFirst === 1 && countSecond === 1;
    return {
      name: "project-resolver-gitignore-no-duplicate",
      passed,
      message: passed ? ".klm/ once" : `counts first=${countFirst} second=${countSecond}`,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function evalGitignoreCreatesWhenMissing(): EvalResult {
  const dir = mkdtempSync(join(tmpdir(), "klm-gi-create-"));
  try {
    const result = ensureGitignoreKlm(dir);
    const content = readFileSync(join(dir, ".gitignore"), "utf-8");
    const passed = result.created && countGitignoreKlmEntries(content) === 1;
    return {
      name: "project-resolver-gitignore-creates",
      passed,
      message: passed ? "created .gitignore with .klm/" : "failed",
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function evalFingerprintMismatchFails(): Promise<EvalResult> {
  const dir = mkdtempSync(join(tmpdir(), "klm-fpm-"));
  try {
    await initProject({ root: dir });
    const manifest = readManifest(dir)!;
    writeFileSync(
      join(dir, ".klm", "project.json"),
      `${JSON.stringify({ ...manifest, rootFingerprint: "git:github.com/other/repo" })}\n`
    );

    let threw = false;
    try {
      await initProject({ root: dir });
    } catch (err) {
      threw = err instanceof ProjectFingerprintMismatchError;
    }

    return {
      name: "project-resolver-fingerprint-mismatch-fails",
      passed: threw,
      message: threw ? "PROJECT_FINGERPRINT_MISMATCH" : "expected throw",
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function evalRepairUpdatesFingerprint(): Promise<EvalResult> {
  const dir = mkdtempSync(join(tmpdir(), "klm-repair-"));
  try {
    const first = await initProject({ root: dir });
    writeFileSync(
      join(dir, ".klm", "project.json"),
      `${JSON.stringify({ ...first.manifest, rootFingerprint: "git:github.com/stale/repo" })}\n`
    );

    const repaired = await initProject({ root: dir, repair: true });
    const current = computeFingerprint(dir);
    const passed =
      repaired.manifest.projectId === first.manifest.projectId &&
      repaired.manifest.rootFingerprint === current.rootFingerprint &&
      repaired.repaired === true;

    return {
      name: "project-resolver-repair-keeps-project-id",
      passed,
      message: passed ? `repaired fp=${current.rootFingerprint}` : "repair failed",
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function evalCliRequiresInit(): Promise<EvalResult> {
  const dir = mkdtempSync(join(tmpdir(), "klm-noinit-"));
  try {
    let threw = false;
    try {
      resolveForCli(dir);
    } catch (err) {
      threw = err instanceof ProjectNotInitializedError;
    }
    return {
      name: "project-resolver-cli-not-initialized",
      passed: threw,
      message: threw ? "PROJECT_NOT_INITIALIZED" : "expected error",
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function evalCliReadsManifest(): Promise<EvalResult> {
  const dir = mkdtempSync(join(tmpdir(), "klm-manifest-"));
  const projectId = "00000000-0000-4000-8000-000000000099";
  try {
    mkdirSync(join(dir, ".klm"), { recursive: true });
    writeFileSync(
      join(dir, ".klm", "project.json"),
      `${JSON.stringify({
        projectId,
        name: "test",
        rootPath: dir,
        rootFingerprint: "path:test",
        createdAt: new Date().toISOString(),
        organizationId: "00000000-0000-4000-8000-000000000001",
        workspaceId: "00000000-0000-4000-8000-000000000002",
      })}\n`
    );

    const resolved = resolveForCli(dir);
    const id = await resolveProjectIdForRoot(dir);
    const passed = resolved.manifest.projectId === projectId && id === projectId;

    return {
      name: "project-resolver-cli-reads-manifest",
      passed,
      message: passed ? projectId : `got ${id}`,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function evalMcpEnvFallback(): EvalResult {
  const dir = mkdtempSync(join(tmpdir(), "klm-mcp-"));
  const envId = "00000000-0000-4000-8000-000000000088";
  const prev = process.env.KLM_WORKSPACE_ROOT;
  delete process.env.KLM_WORKSPACE_ROOT;
  try {
    const resolved = resolveForMcp(dir, envId);
    const passed = resolved.manifest.projectId === envId;
    return {
      name: "project-resolver-mcp-env-fallback",
      passed,
      message: passed ? `env → ${envId}` : `got ${resolved.manifest.projectId}`,
    };
  } finally {
    if (prev) process.env.KLM_WORKSPACE_ROOT = prev;
    rmSync(dir, { recursive: true, force: true });
  }
}

export function evalMcpRequiresWorkspaceRoot(): EvalResult {
  const dir = mkdtempSync(join(tmpdir(), "klm-mcp-ws-"));
  const prev = process.env.KLM_WORKSPACE_ROOT;
  delete process.env.KLM_WORKSPACE_ROOT;
  try {
    let threw = false;
    try {
      resolveForMcp(dir);
    } catch (err) {
      threw = err instanceof McpWorkspaceRootError;
    }
    return {
      name: "project-resolver-mcp-workspace-root-required",
      passed: threw,
      message: threw ? "MCP_WORKSPACE_ROOT_REQUIRED" : "expected error",
    };
  } finally {
    if (prev) process.env.KLM_WORKSPACE_ROOT = prev;
    rmSync(dir, { recursive: true, force: true });
  }
}

export function evalMcpUsesManifestWithWorkspaceRoot(): EvalResult {
  const dir = mkdtempSync(join(tmpdir(), "klm-mcp-manifest-"));
  const projectId = "00000000-0000-4000-8000-000000000077";
  const prev = process.env.KLM_WORKSPACE_ROOT;
  process.env.KLM_WORKSPACE_ROOT = dir;
  try {
    mkdirSync(join(dir, ".klm"), { recursive: true });
    writeFileSync(
      join(dir, ".klm", "project.json"),
      `${JSON.stringify({
        projectId,
        name: "mcp-test",
        rootPath: dir,
        rootFingerprint: "path:mcp",
        createdAt: new Date().toISOString(),
        organizationId: "00000000-0000-4000-8000-000000000001",
        workspaceId: "00000000-0000-4000-8000-000000000002",
      })}\n`
    );

    const resolved = resolveForMcp(dir);
    const passed = resolved.manifest.projectId === projectId;
    return {
      name: "project-resolver-mcp-uses-manifest",
      passed,
      message: passed ? projectId : `got ${resolved.manifest.projectId}`,
    };
  } finally {
    if (prev) process.env.KLM_WORKSPACE_ROOT = prev;
    else delete process.env.KLM_WORKSPACE_ROOT;
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function runProjectResolverEvals(): Promise<EvalResult[]> {
  return [
    evalGitRemoteNormalization(),
    evalFingerprintStable(),
    evalManifestNoSecrets(),
    await evalInitIdempotent(),
    await evalGitignoreNoDuplicate(),
    evalGitignoreCreatesWhenMissing(),
    await evalFingerprintMismatchFails(),
    await evalRepairUpdatesFingerprint(),
    await evalCliRequiresInit(),
    await evalCliReadsManifest(),
    evalMcpEnvFallback(),
    evalMcpRequiresWorkspaceRoot(),
    evalMcpUsesManifestWithWorkspaceRoot(),
  ];
}
