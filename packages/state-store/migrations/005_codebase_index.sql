-- Phase 2.4: codebase structured index + code chunk types

ALTER TABLE memory_chunks DROP CONSTRAINT IF EXISTS memory_chunks_chunk_type_check;
ALTER TABLE memory_chunks ADD CONSTRAINT memory_chunks_chunk_type_check
  CHECK (chunk_type IN (
    'decision', 'invariant', 'event', 'principle', 'risk',
    'code_file', 'code_symbol', 'code_route'
  ));

CREATE TABLE IF NOT EXISTS code_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES project_states(id) ON DELETE CASCADE,
  relative_path TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  language TEXT,
  line_count INT NOT NULL DEFAULT 0,
  indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, relative_path)
);

CREATE TABLE IF NOT EXISTS code_symbols (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES project_states(id) ON DELETE CASCADE,
  file_id UUID NOT NULL REFERENCES code_files(id) ON DELETE CASCADE,
  symbol_type TEXT NOT NULL CHECK (symbol_type IN (
    'function', 'class', 'interface', 'type', 'enum', 'variable', 'method'
  )),
  name TEXT NOT NULL,
  exported BOOLEAN NOT NULL DEFAULT false,
  line_start INT,
  line_end INT,
  signature TEXT,
  UNIQUE (project_id, file_id, symbol_type, name, line_start)
);

CREATE TABLE IF NOT EXISTS code_dependencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES project_states(id) ON DELETE CASCADE,
  source_file_id UUID NOT NULL REFERENCES code_files(id) ON DELETE CASCADE,
  target_module TEXT NOT NULL,
  import_kind TEXT NOT NULL DEFAULT 'import',
  UNIQUE (project_id, source_file_id, target_module, import_kind)
);

CREATE TABLE IF NOT EXISTS code_routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES project_states(id) ON DELETE CASCADE,
  file_id UUID NOT NULL REFERENCES code_files(id) ON DELETE CASCADE,
  http_method TEXT NOT NULL DEFAULT '',
  path TEXT NOT NULL,
  handler_name TEXT,
  line_number INT
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_code_routes_file_method_path
  ON code_routes (project_id, file_id, http_method, path);

CREATE INDEX IF NOT EXISTS idx_code_files_project ON code_files(project_id);
CREATE INDEX IF NOT EXISTS idx_code_symbols_project ON code_symbols(project_id);
CREATE INDEX IF NOT EXISTS idx_code_symbols_name ON code_symbols(project_id, name);
CREATE INDEX IF NOT EXISTS idx_code_dependencies_project ON code_dependencies(project_id);
CREATE INDEX IF NOT EXISTS idx_code_routes_project ON code_routes(project_id);
