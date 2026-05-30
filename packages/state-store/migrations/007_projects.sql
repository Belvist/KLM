-- Phase 2.6.3 — project identity registry (fingerprint → stable UUID)

CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL,
  organization_id UUID NOT NULL,
  name TEXT NOT NULL,
  root_fingerprint TEXT NOT NULL,
  git_remote TEXT,
  root_path_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_projects_org_fingerprint
  ON projects (organization_id, root_fingerprint);

CREATE INDEX IF NOT EXISTS idx_projects_workspace ON projects (workspace_id);
