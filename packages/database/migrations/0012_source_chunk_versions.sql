-- MEM-025: versioned source chunks preserving historical evidence.
-- Additive: existing rows become current; no row is deleted or rewritten.
-- Re-extraction marks replaced chunks is_current = false instead of deleting them,
-- because memory_evidence / entity_relation_evidence reference chunks ON DELETE CASCADE.

ALTER TABLE public.source_chunks
  ADD COLUMN is_current boolean NOT NULL DEFAULT true;

-- Several historical versions of one ordinal may coexist; only one may be current.
ALTER TABLE public.source_chunks
  DROP CONSTRAINT source_chunks_source_ordinal_unique;

CREATE UNIQUE INDEX source_chunks_source_ordinal_current_unique
  ON public.source_chunks (source_id, ordinal)
  WHERE is_current;

COMMENT ON COLUMN public.source_chunks.is_current IS
  'True for the chunk set of the latest extraction. Historical chunks stay readable through evidence references.';
