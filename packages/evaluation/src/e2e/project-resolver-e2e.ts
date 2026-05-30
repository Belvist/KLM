import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import pg from "pg";
import {
  initProject,
  ProjectFingerprintMismatchError,
  ProjectIdentityConflictError,
  ProjectNotInitializedError,
  readManifest,
  resolveForCli,
  resolveProjectIdForRoot,
  countGitignoreKlmEntries,
} from "@klm/project-resolver";
import { readFileSync } from "node:fs";
import type { EvalResult } from "./helpers.js";
import { record } from "./helpers.js";

export async function runProjectResolverE2e(pool: pg.Pool, results: EvalResult[]): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "klm-e2e-resolver-"));
  const orgId = "00000000-0000-4000-8000-000000000001";
  const workspaceId = "00000000-0000-4000-8000-000000000002";
  const connectionString = process.env.DATABASE_URL!;
  const createdIds: string[] = [];

  try {
    const init1 = await initProject({ root: dir, connectionString });
    createdIds.push(init1.manifest.projectId);

    record(
      results,
      "resolver-e2e-init-manifest",
      Boolean(readManifest(dir)?.projectId),
      `manifest projectId=${init1.manifest.projectId}`
    );

    const init2 = await initProject({ root: dir, connectionString });
    record(
      results,
      "resolver-e2e-init-idempotent",
      init1.manifest.projectId === init2.manifest.projectId && !init2.created,
      `same id=${init2.manifest.projectId}`
    );

    const gitignore = readFileSync(join(dir, ".gitignore"), "utf-8");
    record(
      results,
      "resolver-e2e-gitignore-once",
      countGitignoreKlmEntries(gitignore) === 1,
      `klm entries=${countGitignoreKlmEntries(gitignore)}`
    );

    const row = await pool.query(
      `SELECT id, root_fingerprint FROM projects WHERE id = $1`,
      [init1.manifest.projectId]
    );
    record(
      results,
      "resolver-e2e-projects-row",
      row.rowCount === 1,
      `projects row fingerprint=${row.rows[0]?.root_fingerprint ?? "missing"}`
    );

    const resolvedId = await resolveProjectIdForRoot(dir);
    record(
      results,
      "resolver-e2e-cli-resolve",
      resolvedId === init1.manifest.projectId,
      `resolveProjectIdForRoot=${resolvedId}`
    );

    let noInitErr = false;
    const emptyDir = mkdtempSync(join(tmpdir(), "klm-e2e-empty-"));
    try {
      resolveForCli(emptyDir);
    } catch (err) {
      noInitErr = err instanceof ProjectNotInitializedError;
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
    record(results, "resolver-e2e-not-initialized", noInitErr, "PROJECT_NOT_INITIALIZED");

    const manifest = readManifest(dir)!;
    writeFileSync(
      join(dir, ".klm", "project.json"),
      `${JSON.stringify({ ...manifest, rootFingerprint: "git:github.com/stale/other" })}\n`
    );
    let mismatchErr = false;
    try {
      await initProject({ root: dir, connectionString });
    } catch (err) {
      mismatchErr = err instanceof ProjectFingerprintMismatchError;
    }
    record(results, "resolver-e2e-fingerprint-mismatch", mismatchErr, "PROJECT_FINGERPRINT_MISMATCH");

    writeFileSync(join(dir, ".klm", "project.json"), `${JSON.stringify(manifest)}\n`);

    const fpRow = await pool.query(
      `SELECT id FROM projects WHERE organization_id = $1 AND root_fingerprint = $2`,
      [orgId, init1.manifest.rootFingerprint]
    );
    record(
      results,
      "resolver-e2e-fingerprint-lookup",
      fpRow.rowCount === 1 && fpRow.rows[0]?.id === init1.manifest.projectId,
      `lookup by fingerprint ok`
    );

    const stateRow = await pool.query(`SELECT 1 FROM project_states WHERE id = $1`, [
      init1.manifest.projectId,
    ]);
    record(
      results,
      "resolver-e2e-project-state",
      (stateRow.rowCount ?? 0) >= 1,
      `project_states exists workspace=${workspaceId}`
    );

    const pinnedId = randomUUID();
    const sameFpDir = mkdtempSync(join(tmpdir(), "klm-e2e-samefp-"));
    createdIds.push(pinnedId);
    try {
      await initProject({ root: sameFpDir, connectionString, projectId: pinnedId });
      const again = await initProject({
        root: sameFpDir,
        connectionString,
        projectId: pinnedId,
      });
      record(
        results,
        "resolver-e2e-project-id-same-fingerprint-ok",
        again.manifest.projectId === pinnedId && !again.created,
        `pinned=${pinnedId}`
      );
    } finally {
      rmSync(sameFpDir, { recursive: true, force: true });
    }

    const otherDir = mkdtempSync(join(tmpdir(), "klm-e2e-other-"));
    const thirdDir = mkdtempSync(join(tmpdir(), "klm-e2e-third-"));
    try {
      await initProject({ root: otherDir, connectionString });

      let conflictErr = false;
      try {
        await initProject({
          root: thirdDir,
          connectionString,
          projectId: init1.manifest.projectId,
        });
      } catch (err) {
        conflictErr = err instanceof ProjectIdentityConflictError;
      }
      record(
        results,
        "resolver-e2e-project-id-different-fingerprint-fails",
        conflictErr,
        "PROJECT_IDENTITY_CONFLICT"
      );
    } finally {
      rmSync(otherDir, { recursive: true, force: true });
      rmSync(thirdDir, { recursive: true, force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
    for (const id of createdIds) {
      await pool.query(`DELETE FROM projects WHERE id = $1`, [id]).catch(() => {});
      await pool.query(`DELETE FROM project_states WHERE id = $1`, [id]).catch(() => {});
    }
  }
}
