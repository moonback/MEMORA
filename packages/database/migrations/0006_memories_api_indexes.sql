-- MEM-016: query-path indexes for memory lifecycle and evidence provenance.
CREATE INDEX IF NOT EXISTS memories_workspace_status_updated_idx
  ON memories (workspace_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS memory_evidence_workspace_chunk_idx
  ON memory_evidence (workspace_id, source_chunk_id);

CREATE INDEX IF NOT EXISTS memory_evidence_memory_created_idx
  ON memory_evidence (workspace_id, memory_id, created_at);
