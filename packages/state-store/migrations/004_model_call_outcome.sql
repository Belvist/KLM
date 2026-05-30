-- Phase 2.3.3: model call failure telemetry

ALTER TABLE model_calls
  ADD COLUMN IF NOT EXISTS outcome TEXT NOT NULL DEFAULT 'success',
  ADD COLUMN IF NOT EXISTS error_code TEXT,
  ADD COLUMN IF NOT EXISTS error_message TEXT;

CREATE INDEX IF NOT EXISTS idx_model_calls_outcome ON model_calls(project_id, outcome, created_at DESC);
