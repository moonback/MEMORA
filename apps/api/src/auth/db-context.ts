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
