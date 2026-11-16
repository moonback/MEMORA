import type { Pool, PoolClient } from "pg";

export class DomainUserNotFoundError extends Error {
  constructor() {
    super("MEMORA user profile not found for the authenticated identity.");
    this.name = "DomainUserNotFoundError";
  }
}

export interface UserContextOptions {
  workspaceId?: string | null;
  invitationTokenHash?: string | null;
}

export async function setAuthUserContext(client: PoolClient, authUserId: string): Promise<void> {
  await client.query("SELECT set_config('app.auth_user_id', $1, true)", [authUserId]);
}

export async function setUserContext(client: PoolClient, userId: string): Promise<void> {
  await client.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);
}

export async function setWorkspaceContext(client: PoolClient, workspaceId: string | null): Promise<void> {
  await client.query("SELECT set_config('app.current_workspace_id', $1, true)", [workspaceId ?? ""]);
}

export async function setInvitationTokenContext(client: PoolClient, tokenHash: string | null): Promise<void> {
  await client.query("SELECT set_config('app.invitation_token_hash', $1, true)", [tokenHash ?? ""]);
}

export async function withUserContext<T>(
  pool: Pool,
  authUserId: string,
  action: (client: PoolClient, userId: string) => Promise<T>,
  options: UserContextOptions = {},
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await setAuthUserContext(client, authUserId);
    const userResult = await client.query<{ id: string }>(
      "SELECT id FROM users WHERE auth_user_id = $1 LIMIT 1",
      [authUserId],
    );
    const user = userResult.rows[0];
    if (!user) throw new DomainUserNotFoundError();

    await setUserContext(client, user.id);
    await setWorkspaceContext(client, options.workspaceId ?? null);
    await setInvitationTokenContext(client, options.invitationTokenHash ?? null);
    const result = await action(client, user.id);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

const rlsProtectedTables = [
  "users",
  "workspaces",
  "workspace_members",
  "workspace_invitations",
  "consents",
  "sources",
  "source_chunks",
  "memories",
  "memory_evidence",
  "entities",
  "memory_entities",
  "entity_relations",
  "audit_logs",
] as const;

export async function assertRlsRuntimeRole(pool: Pool): Promise<void> {
  const result = await pool.query<{
    is_superuser: boolean;
    bypasses_rls: boolean;
    owns_rls_table: boolean;
    protected_table_count: number;
  }>(
    `SELECT r.rolsuper AS is_superuser,
            r.rolbypassrls AS bypasses_rls,
            EXISTS (
              SELECT 1 FROM pg_class c
              JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public'
                AND c.relname = ANY($1::text[])
                AND c.relrowsecurity
                AND c.relowner = r.oid
            ) AS owns_rls_table,
            (
              SELECT count(*)::int FROM pg_class c
              JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public'
                AND c.relname = ANY($1::text[])
                AND c.relrowsecurity
            ) AS protected_table_count
     FROM pg_roles r
     WHERE r.rolname = current_user`,
    [rlsProtectedTables],
  );
  const role = result.rows[0];
  if (
    !role
    || role.is_superuser
    || role.bypasses_rls
    || role.owns_rls_table
    || role.protected_table_count !== rlsProtectedTables.length
  ) {
    throw new Error(
      "Unsafe PostgreSQL runtime role: use DATABASE_APP_URL for a non-owner NOSUPERUSER NOBYPASSRLS role after applying all RLS migrations.",
    );
  }
}
