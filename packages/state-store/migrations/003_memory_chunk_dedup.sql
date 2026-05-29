-- Deduplicate semantic memory: one chunk per (project, type, source)

DELETE FROM memory_chunks a
USING memory_chunks b
WHERE a.id > b.id
  AND a.project_id = b.project_id
  AND a.chunk_type = b.chunk_type
  AND a.source_id = b.source_id
  AND a.source_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_memory_chunk_source
ON memory_chunks (project_id, chunk_type, source_id);
