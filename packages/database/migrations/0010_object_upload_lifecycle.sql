-- MEM-021: persisted upload expiry, verification/cleanup leases and safe lifecycle transitions.
ALTER TABLE public.source_objects
  ADD COLUMN expires_at timestamptz,
  ADD COLUMN verification_token uuid,
  ADD COLUMN verification_lease_until timestamptz,
  ADD COLUMN cleanup_lease_token uuid,
  ADD COLUMN cleanup_lease_until timestamptz,
  ADD COLUMN cleanup_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN cleanup_last_error varchar(80);

UPDATE public.source_objects
SET expires_at = CASE
  WHEN status = 'verified'
    THEN GREATEST(COALESCE(verified_at, created_at), created_at + interval '30 minutes') + interval '1 second'
  ELSE created_at + interval '30 minutes'
END
WHERE expires_at IS NULL;

ALTER TABLE public.source_objects
  ALTER COLUMN expires_at SET NOT NULL,
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '30 minutes'),
  ADD CONSTRAINT source_objects_cleanup_attempts_check CHECK (cleanup_attempts >= 0),
  ADD CONSTRAINT source_objects_verified_before_expiry_check
    CHECK (status <> 'verified' OR (verified_at IS NOT NULL AND verified_at < expires_at));

CREATE INDEX source_objects_expired_pending_idx
  ON public.source_objects (expires_at) WHERE status = 'pending';

CREATE OR REPLACE FUNCTION public.memora_enforce_source_object_lifecycle()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'verified' THEN
    IF NEW.status <> 'verified' THEN
      RAISE EXCEPTION 'verified source objects are immutable' USING ERRCODE = '23514';
    END IF;
    IF NEW.storage_provider IS DISTINCT FROM OLD.storage_provider
       OR NEW.bucket_name IS DISTINCT FROM OLD.bucket_name
       OR NEW.object_key IS DISTINCT FROM OLD.object_key THEN
      RAISE EXCEPTION 'verified source object coordinates are immutable' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
    (OLD.status = 'pending' AND NEW.status IN ('verified', 'failed', 'deleted'))
    OR (OLD.status IN ('failed', 'deleted') AND NEW.status = 'pending')
  ) THEN
    RAISE EXCEPTION 'invalid source object lifecycle transition' USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'pending' AND NEW.status = 'verified' AND OLD.expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'expired source objects cannot be verified' USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'pending' AND NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    RAISE EXCEPTION 'pending upload expiry is immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'verified' AND NEW.verified_at IS NOT NULL AND NEW.verified_at >= NEW.expires_at THEN
    RAISE EXCEPTION 'verified timestamp must precede upload expiry' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER source_objects_lifecycle_guard
BEFORE UPDATE ON public.source_objects
FOR EACH ROW EXECUTE FUNCTION public.memora_enforce_source_object_lifecycle();

COMMENT ON COLUMN public.source_objects.expires_at IS
  'Server-enforced deadline for completing a pending upload; independent of presigned URL expiry.';
COMMENT ON COLUMN public.source_objects.cleanup_last_error IS
  'Allow-listed non-sensitive cleanup failure category; never stores provider error text.';
