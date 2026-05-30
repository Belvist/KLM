import pg from "pg";
import type { ProjectIdentityRow } from "./types.js";

export class ProjectsStore {
  private pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async findByFingerprint(
    organizationId: string,
    rootFingerprint: string
  ): Promise<ProjectIdentityRow | null> {
    const res = await this.pool.query(
      `SELECT id, workspace_id, organization_id, name, root_fingerprint, git_remote,
              root_path_hash, created_at, updated_at
       FROM projects
       WHERE organization_id = $1 AND root_fingerprint = $2
       LIMIT 1`,
      [organizationId, rootFingerprint]
    );
    const row = res.rows[0];
    if (!row) return null;
    return mapRow(row);
  }

  async findById(id: string): Promise<ProjectIdentityRow | null> {
    const res = await this.pool.query(
      `SELECT id, workspace_id, organization_id, name, root_fingerprint, git_remote,
              root_path_hash, created_at, updated_at
       FROM projects WHERE id = $1`,
      [id]
    );
    const row = res.rows[0];
    if (!row) return null;
    return mapRow(row);
  }

  async upsert(row: {
    id: string;
    workspaceId: string;
    organizationId: string;
    name: string;
    rootFingerprint: string;
    gitRemote: string | null;
    rootPathHash: string;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO projects (id, workspace_id, organization_id, name, root_fingerprint, git_remote, root_path_hash, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         root_fingerprint = EXCLUDED.root_fingerprint,
         git_remote = EXCLUDED.git_remote,
         root_path_hash = EXCLUDED.root_path_hash,
         updated_at = NOW()`,
      [
        row.id,
        row.workspaceId,
        row.organizationId,
        row.name,
        row.rootFingerprint,
        row.gitRemote,
        row.rootPathHash,
      ]
    );
  }

  async getStats(projectId: string): Promise<{
    files: number;
    routes: number;
    symbols: number;
    invariants: number;
    decisions: number;
  }> {
    const [files, routes, symbols, state] = await Promise.all([
      this.pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM code_files WHERE project_id = $1`,
        [projectId]
      ),
      this.pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM code_routes WHERE project_id = $1`,
        [projectId]
      ),
      this.pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM code_symbols WHERE project_id = $1`,
        [projectId]
      ),
      this.pool.query<{ state: { invariants?: unknown[]; decisions?: unknown[] } }>(
        `SELECT state FROM project_states WHERE id = $1`,
        [projectId]
      ),
    ]);

    const st = state.rows[0]?.state;
    return {
      files: Number(files.rows[0]?.count ?? 0),
      routes: Number(routes.rows[0]?.count ?? 0),
      symbols: Number(symbols.rows[0]?.count ?? 0),
      invariants: st?.invariants?.length ?? 0,
      decisions: st?.decisions?.length ?? 0,
    };
  }
}

function mapRow(row: Record<string, unknown>): ProjectIdentityRow {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    organizationId: String(row.organization_id),
    name: String(row.name),
    rootFingerprint: String(row.root_fingerprint),
    gitRemote: row.git_remote ? String(row.git_remote) : null,
    rootPathHash: String(row.root_path_hash),
    createdAt: new Date(String(row.created_at)),
    updatedAt: new Date(String(row.updated_at)),
  };
}
