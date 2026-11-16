-- MEM-014: PostgreSQL row-level security for workspace isolation.
-- Runtime connections MUST use the non-owner, NOSUPERUSER, NOBYPASSRLS role memora_app.
-- Migration/maintenance connections use DATABASE_URL and intentionally own the schema.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'memora_app') THEN
    RAISE EXCEPTION 'Role memora_app must be provisioned before applying MEM-014 RLS policies';
  END IF;
  IF (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = 'memora_app') THEN
    RAISE EXCEPTION 'Role memora_app must be NOSUPERUSER and NOBYPASSRLS';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION memora_current_auth_user_id()
RETURNS text
LANGUAGE sql STABLE
AS $$
  SELECT nullif(current_setting('app.auth_user_id', true), '')
$$;

CREATE OR REPLACE FUNCTION memora_current_user_id()
RETURNS uuid
LANGUAGE sql STABLE
AS $$
  SELECT nullif(current_setting('app.current_user_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION memora_current_workspace_id()
RETURNS uuid
LANGUAGE sql STABLE
AS $$
  SELECT nullif(current_setting('app.current_workspace_id', true), '')::uuid
$$;

-- SECURITY DEFINER helpers are owned by the migration/table owner, which bypasses
-- RLS. They expose only narrow boolean/role checks to the non-owner app role.
CREATE OR REPLACE FUNCTION memora_workspace_role(p_workspace_id uuid, p_user_id uuid)
RETURNS workspace_role
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT wm.role
  FROM public.workspace_members wm
  WHERE wm.workspace_id = p_workspace_id
    AND wm.user_id = p_user_id
    AND wm.status = 'active'
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION memora_has_workspace_role(
  p_workspace_id uuid,
  p_user_id uuid,
  p_roles workspace_role[]
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(memora_workspace_role(p_workspace_id, p_user_id) = ANY(p_roles), false)
$$;

CREATE OR REPLACE FUNCTION memora_invitation_allows_member(
  p_workspace_id uuid,
  p_user_id uuid,
  p_token_hash text
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspace_invitations i
    JOIN public.users u ON u.id = p_user_id
    WHERE i.workspace_id = p_workspace_id
      AND i.token_hash = p_token_hash
      AND lower(i.email) = lower(u.email)
      AND i.accepted_at IS NULL
      AND i.expires_at > now()
  )
$$;

CREATE OR REPLACE FUNCTION memora_invitation_role(
  p_workspace_id uuid,
  p_user_id uuid,
  p_token_hash text
)
RETURNS workspace_role
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $
  SELECT i.role
  FROM public.workspace_invitations i
  JOIN public.users u ON u.id = p_user_id
  WHERE i.workspace_id = p_workspace_id
    AND i.token_hash = p_token_hash
    AND lower(i.email) = lower(u.email)
    AND i.accepted_at IS NULL
    AND i.expires_at > now()
  LIMIT 1
$;

REVOKE ALL ON FUNCTION memora_current_auth_user_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION memora_current_user_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION memora_current_workspace_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION memora_workspace_role(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION memora_has_workspace_role(uuid, uuid, workspace_role[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION memora_invitation_allows_member(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION memora_invitation_role(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION memora_current_auth_user_id() TO memora_app;
GRANT EXECUTE ON FUNCTION memora_current_user_id() TO memora_app;
GRANT EXECUTE ON FUNCTION memora_current_workspace_id() TO memora_app;
GRANT EXECUTE ON FUNCTION memora_workspace_role(uuid, uuid) TO memora_app;
GRANT EXECUTE ON FUNCTION memora_has_workspace_role(uuid, uuid, workspace_role[]) TO memora_app;
GRANT EXECUTE ON FUNCTION memora_invitation_allows_member(uuid, uuid, text) TO memora_app;
GRANT EXECUTE ON FUNCTION memora_invitation_role(uuid, uuid, text) TO memora_app;

-- Identity rows are visible to their owner, or to active members in the current workspace.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY users_select_scope ON users
  FOR SELECT TO memora_app
  USING (
    id = memora_current_user_id()
    OR auth_user_id = memora_current_auth_user_id()
    OR EXISTS (
      SELECT 1 FROM workspace_members wm
      WHERE wm.user_id = users.id
        AND wm.workspace_id = memora_current_workspace_id()
        AND wm.status = 'active'
        AND memora_workspace_role(wm.workspace_id, memora_current_user_id()) IS NOT NULL
    )
  );
CREATE POLICY users_insert_self ON users
  FOR INSERT TO memora_app
  WITH CHECK (auth_user_id = memora_current_auth_user_id());
CREATE POLICY users_update_self ON users
  FOR UPDATE TO memora_app
  USING (id = memora_current_user_id() OR auth_user_id = memora_current_auth_user_id())
  WITH CHECK (id = memora_current_user_id() OR auth_user_id = memora_current_auth_user_id());

-- Workspace metadata is visible only to its owner or a current member.
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspaces_select_scope ON workspaces
  FOR SELECT TO memora_app
  USING (
    owner_user_id = memora_current_user_id()
    OR memora_workspace_role(id, memora_current_user_id()) IS NOT NULL
    OR EXISTS (
      SELECT 1 FROM workspace_invitations i
      WHERE i.workspace_id = workspaces.id
        AND i.token_hash = nullif(current_setting('app.invitation_token_hash', true), '')
        AND i.accepted_at IS NULL
        AND i.expires_at > now()
    )
  );
CREATE POLICY workspaces_insert_owner ON workspaces
  FOR INSERT TO memora_app
  WITH CHECK (owner_user_id = memora_current_user_id());
CREATE POLICY workspaces_update_owner_admin ON workspaces
  FOR UPDATE TO memora_app
  USING (
    owner_user_id = memora_current_user_id()
    OR (id = memora_current_workspace_id()
        AND memora_has_workspace_role(id, memora_current_user_id(), ARRAY['owner','admin']::workspace_role[]))
  )
  WITH CHECK (
    owner_user_id = memora_current_user_id()
    OR (id = memora_current_workspace_id()
        AND memora_has_workspace_role(id, memora_current_user_id(), ARRAY['owner','admin']::workspace_role[]))
  );

-- Memberships: users can enumerate their own memberships; members can see
-- other memberships only inside their transaction-scoped current workspace.
ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_members_select_scope ON workspace_members
  FOR SELECT TO memora_app
  USING (
    user_id = memora_current_user_id()
    OR (workspace_id = memora_current_workspace_id()
        AND memora_workspace_role(workspace_id, memora_current_user_id()) IS NOT NULL)
  );
CREATE POLICY workspace_members_insert_owner_or_invited_self ON workspace_members
  FOR INSERT TO memora_app
  WITH CHECK (
    (
      user_id = memora_current_user_id()
      AND role = 'owner'
      AND EXISTS (
        SELECT 1 FROM workspaces w
        WHERE w.id = workspace_members.workspace_id
          AND w.owner_user_id = memora_current_user_id()
      )
    )
    OR (
      workspace_id = memora_current_workspace_id()
      AND user_id = memora_current_user_id()
      AND role = memora_invitation_role(
        workspace_id,
        user_id,
        nullif(current_setting('app.invitation_token_hash', true), '')
      )
    )
  );
CREATE POLICY workspace_members_update_roles ON workspace_members
  FOR UPDATE TO memora_app
  USING (
    workspace_id = memora_current_workspace_id()
    AND (
      (
        memora_has_workspace_role(workspace_id, memora_current_user_id(), ARRAY['owner']::workspace_role[])
        AND role <> 'owner'
      )
      OR (
        memora_has_workspace_role(workspace_id, memora_current_user_id(), ARRAY['admin']::workspace_role[])
        AND role IN ('member', 'viewer')
      )
      OR (
        user_id = memora_current_user_id()
        AND status <> 'active'
        AND memora_invitation_role(
          workspace_id,
          user_id,
          nullif(current_setting('app.invitation_token_hash', true), '')
        ) IS NOT NULL
      )
      OR (
        user_id = memora_current_user_id()
        AND EXISTS (
          SELECT 1 FROM workspaces w
          WHERE w.id = workspace_members.workspace_id
            AND w.owner_user_id = memora_current_user_id()
        )
      )
    )
  )
  WITH CHECK (
    workspace_id = memora_current_workspace_id()
    AND (
      (
        memora_has_workspace_role(workspace_id, memora_current_user_id(), ARRAY['owner']::workspace_role[])
        AND role <> 'owner'
      )
      OR (
        memora_has_workspace_role(workspace_id, memora_current_user_id(), ARRAY['admin']::workspace_role[])
        AND role IN ('member', 'viewer')
      )
      OR (
        user_id = memora_current_user_id()
        AND role = memora_invitation_role(
          workspace_id,
          user_id,
          nullif(current_setting('app.invitation_token_hash', true), '')
        )
        AND status = 'active'
      )
      OR (
        user_id = memora_current_user_id()
        AND role = 'owner'
        AND EXISTS (
          SELECT 1 FROM workspaces w
          WHERE w.id = workspace_members.workspace_id
            AND w.owner_user_id = memora_current_user_id()
        )
      )
    )
  );
CREATE POLICY workspace_members_delete_roles_or_self ON workspace_members
  FOR DELETE TO memora_app
  USING (
    workspace_id = memora_current_workspace_id()
    AND (
      (
        memora_has_workspace_role(workspace_id, memora_current_user_id(), ARRAY['owner']::workspace_role[])
        AND role <> 'owner'
      )
      OR (
        memora_has_workspace_role(workspace_id, memora_current_user_id(), ARRAY['admin']::workspace_role[])
        AND role IN ('member', 'viewer')
      )
      OR (user_id = memora_current_user_id() AND role <> 'owner')
    )
  );

-- Invitations are private to workspace owners/admins. The exact token hash is
-- the sole additional read/update capability during invitation acceptance.
ALTER TABLE workspace_invitations ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_invitations_select_scope ON workspace_invitations
  FOR SELECT TO memora_app
  USING (
    (
      workspace_id = memora_current_workspace_id()
      AND memora_has_workspace_role(workspace_id, memora_current_user_id(), ARRAY['owner','admin']::workspace_role[])
    )
    OR token_hash = nullif(current_setting('app.invitation_token_hash', true), '')
  );
CREATE POLICY workspace_invitations_insert_managers ON workspace_invitations
  FOR INSERT TO memora_app
  WITH CHECK (
    workspace_id = memora_current_workspace_id()
    AND role <> 'owner'
    AND (
      memora_has_workspace_role(workspace_id, memora_current_user_id(), ARRAY['owner']::workspace_role[])
      OR (
        role IN ('member', 'viewer')
        AND memora_has_workspace_role(workspace_id, memora_current_user_id(), ARRAY['admin']::workspace_role[])
      )
    )
  );
CREATE POLICY workspace_invitations_update_managers_or_token ON workspace_invitations
  FOR UPDATE TO memora_app
  USING (
    (
      workspace_id = memora_current_workspace_id()
      AND (
        memora_has_workspace_role(workspace_id, memora_current_user_id(), ARRAY['owner']::workspace_role[])
        OR (
          role IN ('member', 'viewer')
          AND memora_has_workspace_role(workspace_id, memora_current_user_id(), ARRAY['admin']::workspace_role[])
        )
      )
    )
    OR token_hash = nullif(current_setting('app.invitation_token_hash', true), '')
  )
  WITH CHECK (
    (
      workspace_id = memora_current_workspace_id()
      AND (
        memora_has_workspace_role(workspace_id, memora_current_user_id(), ARRAY['owner']::workspace_role[])
        OR (
          role IN ('member', 'viewer')
          AND memora_has_workspace_role(workspace_id, memora_current_user_id(), ARRAY['admin']::workspace_role[])
        )
      )
    )
    OR token_hash = nullif(current_setting('app.invitation_token_hash', true), '')
  );
CREATE POLICY workspace_invitations_delete_managers ON workspace_invitations
  FOR DELETE TO memora_app
  USING (
    workspace_id = memora_current_workspace_id()
    AND (
      memora_has_workspace_role(workspace_id, memora_current_user_id(), ARRAY['owner']::workspace_role[])
      OR (
        role IN ('member', 'viewer')
        AND memora_has_workspace_role(workspace_id, memora_current_user_id(), ARRAY['admin']::workspace_role[])
      )
    )
  );

-- Consent records are private to their subject and workspace managers.
ALTER TABLE consents ENABLE ROW LEVEL SECURITY;
CREATE POLICY consents_select_scope ON consents
  FOR SELECT TO memora_app
  USING (
    workspace_id = memora_current_workspace_id()
    AND (
      user_id = memora_current_user_id()
      OR memora_has_workspace_role(workspace_id, memora_current_user_id(), ARRAY['owner','admin']::workspace_role[])
    )
  );
CREATE POLICY consents_insert_self ON consents
  FOR INSERT TO memora_app
  WITH CHECK (workspace_id = memora_current_workspace_id() AND user_id = memora_current_user_id());
CREATE POLICY consents_update_self_or_manager ON consents
  FOR UPDATE TO memora_app
  USING (
    workspace_id = memora_current_workspace_id()
    AND (
      user_id = memora_current_user_id()
      OR memora_has_workspace_role(workspace_id, memora_current_user_id(), ARRAY['owner','admin']::workspace_role[])
    )
  )
  WITH CHECK (
    workspace_id = memora_current_workspace_id()
    AND (
      user_id = memora_current_user_id()
      OR memora_has_workspace_role(workspace_id, memora_current_user_id(), ARRAY['owner','admin']::workspace_role[])
    )
  );

-- Workspace content: active members can read; viewers are read-only.
DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'sources', 'source_chunks', 'memories', 'memory_evidence',
    'entities', 'memory_entities', 'entity_relations'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT TO memora_app USING (
         workspace_id = memora_current_workspace_id()
         AND memora_workspace_role(workspace_id, memora_current_user_id()) IS NOT NULL
       )',
      table_name || '_select_scope', table_name
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR INSERT TO memora_app WITH CHECK (
         workspace_id = memora_current_workspace_id()
         AND memora_has_workspace_role(workspace_id, memora_current_user_id(), ARRAY[''owner'',''admin'',''member'']::workspace_role[])
       )',
      table_name || '_insert_members', table_name
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR UPDATE TO memora_app USING (
         workspace_id = memora_current_workspace_id()
         AND memora_has_workspace_role(workspace_id, memora_current_user_id(), ARRAY[''owner'',''admin'',''member'']::workspace_role[])
       ) WITH CHECK (
         workspace_id = memora_current_workspace_id()
         AND memora_has_workspace_role(workspace_id, memora_current_user_id(), ARRAY[''owner'',''admin'',''member'']::workspace_role[])
       )',
      table_name || '_update_members', table_name
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR DELETE TO memora_app USING (
         workspace_id = memora_current_workspace_id()
         AND memora_has_workspace_role(workspace_id, memora_current_user_id(), ARRAY[''owner'',''admin'',''member'']::workspace_role[])
       )',
      table_name || '_delete_members', table_name
    );
  END LOOP;
END
$$;

-- The creator columns on sources/memories must match the authenticated user.
DROP POLICY sources_insert_members ON sources;
CREATE POLICY sources_insert_members ON sources
  FOR INSERT TO memora_app
  WITH CHECK (
    workspace_id = memora_current_workspace_id()
    AND created_by_user_id = memora_current_user_id()
    AND memora_has_workspace_role(workspace_id, memora_current_user_id(), ARRAY['owner','admin','member']::workspace_role[])
  );
DROP POLICY memories_insert_members ON memories;
CREATE POLICY memories_insert_members ON memories
  FOR INSERT TO memora_app
  WITH CHECK (
    workspace_id = memora_current_workspace_id()
    AND created_by_user_id = memora_current_user_id()
    AND memora_has_workspace_role(workspace_id, memora_current_user_id(), ARRAY['owner','admin','member']::workspace_role[])
  );

-- Audit records are append-only and visible only to workspace managers.
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_logs_select_managers ON audit_logs
  FOR SELECT TO memora_app
  USING (
    workspace_id = memora_current_workspace_id()
    AND memora_has_workspace_role(workspace_id, memora_current_user_id(), ARRAY['owner','admin']::workspace_role[])
  );
CREATE POLICY audit_logs_insert_members ON audit_logs
  FOR INSERT TO memora_app
  WITH CHECK (
    workspace_id = memora_current_workspace_id()
    AND (actor_user_id IS NULL OR actor_user_id = memora_current_user_id())
    AND memora_has_workspace_role(workspace_id, memora_current_user_id(), ARRAY['owner','admin','member']::workspace_role[])
  );

-- No UPDATE/DELETE policies are defined for audit logs or consent deletion.
