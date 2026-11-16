-- MEM-024: durable, tenant-scoped ingestion state and transactional outbox.
-- The outbox is written by database triggers in the same transaction as source readiness.
CREATE TABLE public.source_ingestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  source_id uuid NOT NULL,
  source_version integer NOT NULL DEFAULT 1,
  status varchar(24) NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  lease_until timestamptz,
  heartbeat_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  last_error_code varchar(80),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT source_ingestions_source_version_unique UNIQUE (source_id, source_version),
  CONSTRAINT source_ingestions_source_workspace_fk
    FOREIGN KEY (source_id, workspace_id) REFERENCES public.sources(id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT source_ingestions_status_check CHECK (status IN ('queued', 'processing', 'succeeded', 'failed')),
  CONSTRAINT source_ingestions_attempts_check CHECK (attempts >= 0 AND max_attempts BETWEEN 1 AND 10)
);
CREATE INDEX source_ingestions_workspace_status_idx
  ON public.source_ingestions (workspace_id, status, updated_at DESC);
CREATE INDEX source_ingestions_claim_idx
  ON public.source_ingestions (available_at, created_at)
  WHERE status = 'queued';

CREATE TABLE public.source_ingestion_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  source_id uuid NOT NULL,
  ingestion_id uuid NOT NULL REFERENCES public.source_ingestions(id) ON DELETE CASCADE,
  event_type varchar(80) NOT NULL DEFAULT 'source.ingestion.requested',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  lease_until timestamptz,
  published_at timestamptz,
  last_error_code varchar(80),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT source_ingestion_outbox_event_unique UNIQUE (ingestion_id, event_type),
  CONSTRAINT source_ingestion_outbox_source_workspace_fk
    FOREIGN KEY (source_id, workspace_id) REFERENCES public.sources(id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT source_ingestion_outbox_payload_check CHECK (payload = '{}'::jsonb),
  CONSTRAINT source_ingestion_outbox_attempts_check CHECK (attempts >= 0)
);
CREATE INDEX source_ingestion_outbox_dispatch_idx
  ON public.source_ingestion_outbox (available_at, created_at)
  WHERE published_at IS NULL;

ALTER TABLE public.source_ingestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.source_ingestions FORCE ROW LEVEL SECURITY;
CREATE POLICY source_ingestions_workspace_isolation ON public.source_ingestions
  USING (workspace_id = public.memora_current_workspace_id())
  WITH CHECK (workspace_id = public.memora_current_workspace_id());

-- Outbox access is reserved to the trusted system role. The application role cannot
-- enumerate cross-workspace events or mutate delivery state.
ALTER TABLE public.source_ingestion_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.source_ingestion_outbox FORCE ROW LEVEL SECURITY;
CREATE POLICY source_ingestion_outbox_system_access ON public.source_ingestion_outbox
  USING (current_user <> 'memora_app')
  WITH CHECK (current_user <> 'memora_app');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'memora_app') THEN
    GRANT SELECT ON public.source_ingestions TO memora_app;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.memora_enqueue_source_ingestion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  new_ingestion_id uuid;
BEGIN
  INSERT INTO public.source_ingestions (workspace_id, source_id, source_version)
  VALUES (NEW.workspace_id, NEW.id, 1)
  ON CONFLICT (source_id, source_version) DO NOTHING
  RETURNING id INTO new_ingestion_id;

  IF new_ingestion_id IS NOT NULL THEN
    INSERT INTO public.source_ingestion_outbox (workspace_id, source_id, ingestion_id)
    VALUES (NEW.workspace_id, NEW.id, new_ingestion_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sources_enqueue_ingestion_when_ready
AFTER UPDATE OF status ON public.sources
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'ready')
EXECUTE FUNCTION public.memora_enqueue_source_ingestion();

CREATE OR REPLACE FUNCTION public.memora_mark_source_ready_after_object_verification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'verified' THEN
    UPDATE public.sources
    SET status = 'ready', processed_at = now(), updated_at = now()
    WHERE id = NEW.source_id AND workspace_id = NEW.workspace_id
      AND status IN ('pending', 'processing');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER source_objects_enqueue_ingestion_when_verified
AFTER UPDATE OF status ON public.source_objects
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'verified')
EXECUTE FUNCTION public.memora_mark_source_ready_after_object_verification();

COMMENT ON TABLE public.source_ingestions IS
  'Tenant-scoped ingestion lifecycle. This records orchestration only; extraction and indexing are separate pipeline stages.';
COMMENT ON TABLE public.source_ingestion_outbox IS
  'Transactional outbox containing identifiers only. Never store source content, credentials, signed URLs or private metadata.';
