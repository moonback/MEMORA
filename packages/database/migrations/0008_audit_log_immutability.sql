-- MEM-018: operational, append-only audit trail for workspace mutations.
-- Values of private domain fields are deliberately never copied into audit metadata.

CREATE OR REPLACE FUNCTION public.memora_audit_workspace_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_workspace_id uuid;
  target_resource_id uuid;
  actor_id uuid;
  changed_fields jsonb := '[]'::jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_workspace_id := OLD.workspace_id;
    target_resource_id := OLD.id;
  ELSE
    target_workspace_id := NEW.workspace_id;
    target_resource_id := NEW.id;
  END IF;

  actor_id := NULLIF(current_setting('app.user_id', true), '')::uuid;

  IF TG_OP = 'UPDATE' THEN
    SELECT COALESCE(jsonb_agg(n.key ORDER BY n.key), '[]'::jsonb)
      INTO changed_fields
    FROM jsonb_each(to_jsonb(NEW)) AS n
    JOIN jsonb_each(to_jsonb(OLD)) AS o USING (key)
    WHERE n.value IS DISTINCT FROM o.value
      AND n.key NOT IN (
        'content', 'summary', 'metadata', 'attributes', 'aliases', 'description',
        'canonical_name', 'title', 'original_name', 'storage_key',
        'checksum_sha256', 'external_id', 'ip_address', 'user_agent'
      );
  END IF;

  INSERT INTO public.audit_logs (
    workspace_id, actor_user_id, action, resource_type, resource_id, outcome, metadata
  ) VALUES (
    target_workspace_id,
    actor_id,
    lower(TG_TABLE_NAME) || '.' || lower(TG_OP),
    TG_TABLE_NAME,
    target_resource_id,
    'success',
    jsonb_build_object(
      'table', TG_TABLE_NAME,
      'operation', lower(TG_OP),
      'changed_fields', changed_fields
    )
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.memora_prevent_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Permit referential cascades (for example, account/workspace erasure), but
  -- reject direct edits or deletes of individual audit events.
  IF pg_trigger_depth() > 1 THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  RAISE EXCEPTION 'audit log events are append-only'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER audit_logs_append_only
BEFORE UPDATE OR DELETE ON public.audit_logs
FOR EACH ROW EXECUTE FUNCTION public.memora_prevent_audit_mutation();

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['sources', 'memories', 'entities', 'entity_relations']
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.memora_audit_workspace_mutation()',
      table_name || '_audit_mutation',
      table_name
    );
  END LOOP;
END $$;

COMMENT ON FUNCTION public.memora_audit_workspace_mutation() IS
  'Records workspace-scoped INSERT/UPDATE events without copying private field values.';
COMMENT ON FUNCTION public.memora_prevent_audit_mutation() IS
  'Prevents direct audit event updates/deletes while allowing referential cascades.';
