-- MEM-017: confidence and source provenance for knowledge relations.
ALTER TABLE entity_relations
  ADD COLUMN confidence integer,
  ADD CONSTRAINT entity_relations_confidence_range
    CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 100)),
  ADD CONSTRAINT entity_relations_id_workspace_unique UNIQUE (id, workspace_id);

CREATE TABLE entity_relation_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  relation_id uuid NOT NULL,
  source_chunk_id uuid NOT NULL,
  quote text,
  confidence integer CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 100)),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT entity_relation_evidence_relation_workspace_fk
    FOREIGN KEY (relation_id, workspace_id)
    REFERENCES entity_relations(id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT entity_relation_evidence_chunk_workspace_fk
    FOREIGN KEY (source_chunk_id, workspace_id)
    REFERENCES source_chunks(id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT entity_relation_evidence_relation_chunk_unique UNIQUE (relation_id, source_chunk_id)
);

CREATE INDEX entity_relation_evidence_workspace_relation_idx
  ON entity_relation_evidence(workspace_id, relation_id);
CREATE INDEX entity_relation_evidence_workspace_chunk_idx
  ON entity_relation_evidence(workspace_id, source_chunk_id);

ALTER TABLE entity_relation_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_relation_evidence FORCE ROW LEVEL SECURITY;
CREATE POLICY entity_relation_evidence_workspace_isolation
  ON entity_relation_evidence
  USING (workspace_id = public.memora_current_workspace_id())
  WITH CHECK (workspace_id = public.memora_current_workspace_id());
