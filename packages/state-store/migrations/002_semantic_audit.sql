-- Phase 2: semantic memory, audit, model telemetry

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS memory_chunks (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES project_states(id) ON DELETE CASCADE,
  chunk_type TEXT NOT NULL CHECK (chunk_type IN ('decision', 'invariant', 'event', 'principle', 'risk')),
  source_id UUID,
  content TEXT NOT NULL,
  embedding vector(1536),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_memory_chunks_project ON memory_chunks(project_id);
CREATE INDEX IF NOT EXISTS idx_memory_chunks_type ON memory_chunks(project_id, chunk_type);

-- IVFFlat requires rows; index created after seed in production ops
-- CREATE INDEX idx_memory_chunks_embedding ON memory_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  project_id UUID NOT NULL,
  user_id UUID NOT NULL,
  request_id UUID,
  action TEXT NOT NULL,
  resource TEXT,
  outcome TEXT NOT NULL DEFAULT 'success',
  payload JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_project_ts ON audit_logs(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS model_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID,
  project_id UUID,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  task_type TEXT NOT NULL,
  prompt_tokens INT NOT NULL DEFAULT 0,
  completion_tokens INT NOT NULL DEFAULT 0,
  total_tokens INT NOT NULL DEFAULT 0,
  latency_ms INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_model_calls_project_ts ON model_calls(project_id, created_at DESC);
