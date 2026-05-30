-- Allow stable textual source ids for codebase semantic chunks.
-- Examples: code:file:..., code:symbol:..., code:route:...

ALTER TABLE memory_chunks
  ALTER COLUMN source_id TYPE TEXT
  USING source_id::text;

-- uniq_memory_chunk_source from 003 remains valid on:
-- (project_id, chunk_type, source_id)
