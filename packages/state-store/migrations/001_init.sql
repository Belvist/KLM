-- KLM Runtime — minimal persistent schema (Phase 1.5)

CREATE TABLE IF NOT EXISTS project_states (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL,
  state JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES project_states(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL,
  importance REAL NOT NULL DEFAULT 0.5,
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_events_project_ts ON events(project_id, timestamp DESC);

CREATE TABLE IF NOT EXISTS user_states (
  id UUID PRIMARY KEY,
  state JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
