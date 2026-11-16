-- MEM-019: workspace-scoped metadata for private source objects.
-- Binary bytes remain in a private EU S3-compatible bucket; this table stores only
-- server-generated object coordinates and verified metadata.

CREATE TABLE public.source_objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  source_id uuid NOT NULL,
  storage_provider varchar(80) NOT NULL,
  bucket_name varchar(160) NOT NULL,
  object_key text NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'pending',
  content_type varchar(160) NOT NULL,
  byte_size bigint,
  checksum_sha256 varchar(64),
  etag varchar(256),
  version_id varchar(512),
  uploaded_at timestamptz,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT source_objects_id_workspace_unique UNIQUE (id, workspace_id),
  CONSTRAINT source_objects_source_workspace_fk
    FOREIGN KEY (source_id, workspace_id) REFERENCES public.sources(id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT source_objects_source_unique UNIQUE (source_id),
  CONSTRAINT source_objects_storage_address_unique UNIQUE (storage_provider, bucket_name, object_key),
  CONSTRAINT source_objects_status_check CHECK (status IN ('pending', 'uploaded', 'verified', 'failed', 'deleted')),
  CONSTRAINT source_objects_content_type_check CHECK (length(trim(content_type)) > 0),
  CONSTRAINT source_objects_byte_size_check CHECK (byte_size IS NULL OR byte_size BETWEEN 1 AND 104857600),
  CONSTRAINT source_objects_checksum_check CHECK (checksum_sha256 IS NULL OR checksum_sha256 ~ '^[a-fA-F0-9]{64}$'),
  CONSTRAINT source_objects_verified_requires_upload CHECK (status <> 'verified' OR (uploaded_at IS NOT NULL AND verified_at IS NOT NULL AND byte_size IS NOT NULL AND checksum_sha256 IS NOT NULL))
);

CREATE INDEX source_objects_workspace_status_idx ON public.source_objects(workspace_id, status);

ALTER TABLE public.source_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.source_objects FORCE ROW LEVEL SECURITY;
CREATE POLICY source_objects_workspace_isolation ON public.source_objects
  USING (workspace_id = public.memora_current_workspace_id())
  WITH CHECK (workspace_id = public.memora_current_workspace_id());

COMMENT ON TABLE public.source_objects IS
  'Private object-storage coordinates and verified upload metadata. Object keys are generated server-side; buckets must remain private and EU-resident.';

-- Local installations may already have provisioned the restricted runtime role.
-- CI provisions it after migrations and grants all current tables in its workflow.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'memora_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.source_objects TO memora_app;
  END IF;
END $$;
