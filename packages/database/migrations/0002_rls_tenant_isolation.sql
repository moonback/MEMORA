-- MEM-014: database-enforced tenant isolation.
-- The API must use a non-owner, NOBYPASSRLS database role and set transaction-local
-- app.auth_user_id / app.user_id / app.workspace_id context for every domain query.

CREATE OR REPLACE FUNCTION public.memora_current_user_id()
RETURNS uuid
LANGUAGE sql STABLE
AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION public.memora_current_workspace_id()
RETURNS uuid
LANGUAGE sql STABLE
AS $$
  SELECT NULLIF(current_setting('app.workspace_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION public.memora_current_auth_user_id()
RETURNS text
LANGUAGE sql STABLE
AS $$
  SELECT NULLIF(current_setting('app.auth_user_id', true), '')
$$;

CREATE OR REPLACE FUNCTION public.memora_current_user_email()
RETURNS text
LANGUAGE sql STABLE
AS $$
  SELECT NULLIF(current_setting('app.user_email', true), '')
$$;

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users FORCE ROW LEVEL SECURITY;
CREATE POLICY users_select_self ON public.users
  FOR SELECT USING (
    auth_user_id = public.memora_current_auth_user_id()
    OR id = public.memora_current_user_id()
  );
CREATE POLICY users_insert_self ON public.users
  FOR INSERT WITH CHECK (auth_user_id = public.memora_current_auth_user_id());
CREATE POLICY users_update_self ON public.users
  FOR UPDATE
  USING (auth_user_id = public.memora_current_auth_user_id())
  WITH CHECK (auth_user_id = public.memora_current_auth_user_id());

ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspaces FORCE ROW LEVEL SECURITY;
CREATE POLICY workspaces_select_member_or_invitee ON public.workspaces
  FOR SELECT USING (
    owner_user_id = public.memora_current_user_id()
    OR EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = workspaces.id
        AND wm.user_id = public.memora_current_user_id()
        AND wm.status = 'active'
    )
    OR EXISTS (
      SELECT 1 FROM public.workspace_invitations wi
      WHERE wi.workspace_id = workspaces.id
        AND lower(wi.email) = lower(public.memora_current_user_email())
        AND wi.accepted_at IS NULL
        AND wi.expires_at > now()
    )
  );
CREATE POLICY workspaces_insert_owner ON public.workspaces
  FOR INSERT WITH CHECK (owner_user_id = public.memora_current_user_id());
CREATE POLICY workspaces_update_owner_or_admin ON public.workspaces
  FOR UPDATE
  USING (
    owner_user_id = public.memora_current_user_id()
    OR EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = workspaces.id
        AND wm.user_id = public.memora_current_user_id()
        AND wm.status = 'active'
        AND wm.role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    owner_user_id = public.memora_current_user_id()
    OR EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = workspaces.id
        AND wm.user_id = public.memora_current_user_id()
        AND wm.status = 'active'
        AND wm.role IN ('owner', 'admin')
    )
  );

ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_members FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_members_select_self_or_current_workspace ON public.workspace_members
  FOR SELECT USING (
    user_id = public.memora_current_user_id()
    OR workspace_id = public.memora_current_workspace_id()
  );
CREATE POLICY workspace_members_insert_self_or_current_workspace ON public.workspace_members
  FOR INSERT WITH CHECK (
    user_id = public.memora_current_user_id()
    OR workspace_id = public.memora_current_workspace_id()
  );
CREATE POLICY workspace_members_update_current_workspace ON public.workspace_members
  FOR UPDATE
  USING (workspace_id = public.memora_current_workspace_id())
  WITH CHECK (workspace_id = public.memora_current_workspace_id());
CREATE POLICY workspace_members_delete_current_workspace ON public.workspace_members
  FOR DELETE USING (
    workspace_id = public.memora_current_workspace_id()
    OR user_id = public.memora_current_user_id()
  );

ALTER TABLE public.workspace_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_invitations FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_invitations_select_workspace_or_recipient ON public.workspace_invitations
  FOR SELECT USING (
    workspace_id = public.memora_current_workspace_id()
    OR (
      lower(email) = lower(public.memora_current_user_email())
      AND accepted_at IS NULL
      AND expires_at > now()
    )
  );
CREATE POLICY workspace_invitations_insert_workspace ON public.workspace_invitations
  FOR INSERT WITH CHECK (workspace_id = public.memora_current_workspace_id());
CREATE POLICY workspace_invitations_update_workspace ON public.workspace_invitations
  FOR UPDATE
  USING (workspace_id = public.memora_current_workspace_id())
  WITH CHECK (workspace_id = public.memora_current_workspace_id());
CREATE POLICY workspace_invitations_delete_workspace ON public.workspace_invitations
  FOR DELETE USING (workspace_id = public.memora_current_workspace_id());

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'sources', 'source_chunks', 'memories', 'memory_evidence',
    'entities', 'memory_entities', 'entity_relations'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I USING (workspace_id = public.memora_current_workspace_id()) WITH CHECK (workspace_id = public.memora_current_workspace_id())',
      table_name || '_workspace_isolation',
      table_name
    );
  END LOOP;
END $$;

ALTER TABLE public.consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consents FORCE ROW LEVEL SECURITY;
CREATE POLICY consents_user_scope ON public.consents
  FOR ALL
  USING (
    workspace_id = public.memora_current_workspace_id()
    AND user_id = public.memora_current_user_id()
  )
  WITH CHECK (
    workspace_id = public.memora_current_workspace_id()
    AND user_id = public.memora_current_user_id()
  );

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_logs_select_workspace ON public.audit_logs
  FOR SELECT USING (workspace_id = public.memora_current_workspace_id());
CREATE POLICY audit_logs_insert_actor ON public.audit_logs
  FOR INSERT WITH CHECK (
    workspace_id = public.memora_current_workspace_id()
    AND (actor_user_id IS NULL OR actor_user_id = public.memora_current_user_id())
  );

COMMENT ON FUNCTION public.memora_current_user_id() IS 'Returns the domain user UUID from transaction-local MEMORA tenant context.';
COMMENT ON FUNCTION public.memora_current_workspace_id() IS 'Returns the workspace UUID from transaction-local MEMORA tenant context.';
