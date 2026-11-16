import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

export interface PersonalWorkspaceRecord {
  id: string;
  name: string;
  slug: string;
  type: "personal";
  description: string | null;
  metadata: Record<string, unknown>;
  archived_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export async function ensurePersonalWorkspace(
  client: PoolClient,
  userId: string,
): Promise<PersonalWorkspaceRecord> {
  const inserted = await client.query<PersonalWorkspaceRecord>(
    `INSERT INTO workspaces (name, slug, type, owner_user_id)
     VALUES ($1, $2, 'personal', $3)
     ON CONFLICT (owner_user_id) WHERE type = 'personal' DO NOTHING
     RETURNING id, name, slug, type, description, metadata, archived_at, created_at, updated_at`,
    ["Espace personnel", `personal-${randomUUID()}`, userId],
  );

  let workspace = inserted.rows[0];
  if (!workspace) {
    const existing = await client.query<PersonalWorkspaceRecord>(
      `SELECT id, name, slug, type, description, metadata, archived_at, created_at, updated_at
       FROM workspaces WHERE owner_user_id = $1 AND type = 'personal' LIMIT 1`,
      [userId],
    );
    workspace = existing.rows[0];
  }
  if (!workspace) throw new Error("Could not ensure the personal workspace.");

  await client.query("SELECT set_config('app.workspace_id', $1, true)", [workspace.id]);
  await client.query(
    `INSERT INTO workspace_members (workspace_id, user_id, role, status, joined_at)
     VALUES ($1, $2, 'owner', 'active', now())
     ON CONFLICT (workspace_id, user_id) DO UPDATE
       SET role = 'owner', status = 'active',
           joined_at = COALESCE(workspace_members.joined_at, now()),
           updated_at = now()`,
    [workspace.id, userId],
  );

  return workspace;
}
