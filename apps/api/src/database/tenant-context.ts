import {
  ForbiddenException,
  NotFoundException,
  ConflictException,
} from "@nestjs/common";
import type { PoolClient } from "pg";
import { authPool } from "../auth/auth.js";

export interface TenantUser {
  id: string;
  email: string;
}

export interface TenantMembership {
  workspaceId: string;
  userId: string;
  role: "owner" | "admin" | "member" | "viewer";
  workspaceType: "personal" | "shared";
}

/** Start a transaction and establish transaction-local identity context. */
export async function beginUserContext(
  client: PoolClient,
  authUserId: string,
): Promise<TenantUser> {
  await client.query("SELECT set_config('app.auth_user_id', $1, true)", [authUserId]);
  const result = await client.query<TenantUser>(
    "SELECT id, email FROM users WHERE auth_user_id = $1 LIMIT 1",
    [authUserId],
  );
  const user = result.rows[0];
  if (!user) throw new NotFoundException("Profil MEMORA introuvable.");
  await client.query("SELECT set_config('app.user_id', $1, true)", [user.id]);
  await client.query("SELECT set_config('app.user_email', $1, true)", [user.email]);
  return user;
}

/** Set a workspace only after verifying the caller's active membership. */
export async function beginWorkspaceContext(
  client: PoolClient,
  authUserId: string,
  workspaceId: string,
): Promise<{ user: TenantUser; membership: TenantMembership }> {
  const user = await beginUserContext(client, authUserId);
  const membershipResult = await client.query<{
    workspace_id: string;
    user_id: string;
    role: TenantMembership["role"];
  }>(
    "SELECT workspace_id, user_id, role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 AND status = 'active' LIMIT 1",
    [workspaceId, user.id],
  );
  const row = membershipResult.rows[0];
  if (!row) throw new ForbiddenException("Vous n'êtes pas membre actif de cet espace.");

  await client.query("SELECT set_config('app.workspace_id', $1, true)", [workspaceId]);
  const workspaceResult = await client.query<{ type: TenantMembership["workspaceType"]; archived_at: Date | null }>(
    "SELECT type, archived_at FROM workspaces WHERE id = $1 LIMIT 1",
    [workspaceId],
  );
  const workspace = workspaceResult.rows[0];
  if (!workspace) throw new NotFoundException("Espace introuvable.");
  if (workspace.archived_at) throw new ConflictException("Cet espace est archivé.");

  return {
    user,
    membership: {
      workspaceId,
      userId: row.user_id,
      role: row.role,
      workspaceType: workspace.type,
    },
  };
}

export async function withUserContext<T>(
  authUserId: string,
  operation: (client: PoolClient, user: TenantUser) => Promise<T>,
): Promise<T> {
  const client = await authPool.connect();
  try {
    await client.query("BEGIN");
    const user = await beginUserContext(client, authUserId);
    const result = await operation(client, user);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function withWorkspaceContext<T>(
  authUserId: string,
  workspaceId: string,
  operation: (client: PoolClient, context: { user: TenantUser; membership: TenantMembership }) => Promise<T>,
): Promise<T> {
  const client = await authPool.connect();
  try {
    await client.query("BEGIN");
    const context = await beginWorkspaceContext(client, authUserId, workspaceId);
    const result = await operation(client, context);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
