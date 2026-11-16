import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Patch,
  Post,
  UnauthorizedException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Pool, PoolClient } from "pg";
import { auth, authPool } from "../auth/auth.js";
import { CurrentSession } from "../auth/current-session.decorator.js";
import { ensurePersonalWorkspace } from "./personal-workspace.service.js";

type AuthSession = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;

type WorkspaceRow = {
  id: string;
  name: string;
  slug: string;
  type: "personal" | "shared";
  description: string | null;
  metadata: Record<string, unknown>;
  archived_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

const workspaceFields = `id, name, slug, type, description, metadata, archived_at, created_at, updated_at`;

const metadataSchema = z.object({
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  icon: z.string().trim().min(1).max(32).optional(),
}).strict();

export const workspaceUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  metadata: metadataSchema.optional(),
}).strict().refine(
  (value) => Object.values(value).some((field) => field !== undefined),
  "Au moins un champ doit être modifié",
);

function toWorkspaceDto(workspace: WorkspaceRow) {
  return {
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    type: workspace.type,
    description: workspace.description,
    metadata: workspace.metadata,
    archivedAt: workspace.archived_at,
    createdAt: workspace.created_at,
    updatedAt: workspace.updated_at,
  };
}

async function getDomainUserId(
  queryable: Pool | PoolClient,
  authUserId: string,
): Promise<string> {
  const result = await queryable.query<{ id: string }>(
    "SELECT id FROM users WHERE auth_user_id = $1 LIMIT 1",
    [authUserId],
  );
  const user = result.rows[0];
  if (!user) throw new NotFoundException("Profil MEMORA introuvable.");
  return user.id;
}

export const sharedWorkspaceCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
}).strict();

@Controller("workspaces")
export class WorkspaceController {
  @Get()
  async list(@CurrentSession() session: AuthSession | undefined) {
    if (!session) throw new UnauthorizedException();
    const userId = await getDomainUserId(authPool, session.user.id);
    const result = await authPool.query<WorkspaceRow & { role: string; status: string }>(
      `SELECT w.id, w.name, w.slug, w.type, w.description, w.metadata,
              w.archived_at, w.created_at, w.updated_at, wm.role, wm.status
       FROM workspace_members wm
       JOIN workspaces w ON w.id = wm.workspace_id
       WHERE wm.user_id = $1 AND wm.status = 'active'
       ORDER BY w.created_at ASC`,
      [userId],
    );
    return {
      workspaces: result.rows.map((row) => {
        const { role, status, ...workspace } = row;
        return { workspace: toWorkspaceDto(workspace), role, status };
      }),
    };
  }

  @Post()
  async createShared(
    @CurrentSession() session: AuthSession | undefined,
    @Body() body: unknown,
  ) {
    if (!session) throw new UnauthorizedException();
    const parsed = sharedWorkspaceCreateSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: "Informations d’espace invalides.",
        issues: parsed.error.issues,
      });
    }

    const client = await authPool.connect();
    try {
      await client.query("BEGIN");
      const userId = await getDomainUserId(client, session.user.id);
      const result = await client.query<WorkspaceRow>(
        `INSERT INTO workspaces (name, slug, type, owner_user_id, description)
         VALUES ($1, $2, 'shared', $3, $4)
         RETURNING ${workspaceFields}`,
        [parsed.data.name, `shared-${randomUUID()}`, userId, parsed.data.description ?? null],
      );
      const workspace = result.rows[0];
      if (!workspace) throw new Error("Shared workspace could not be created.");
      await client.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role, status, joined_at)
         VALUES ($1, $2, 'owner', 'active', now())`,
        [workspace.id, userId],
      );
      await client.query("COMMIT");
      return { workspace: toWorkspaceDto(workspace), role: "owner" as const };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  @Get("personal")
  async getPersonal(@CurrentSession() session: AuthSession | undefined) {
    if (!session) throw new UnauthorizedException();
    const userId = await getDomainUserId(authPool, session.user.id);
    const result = await authPool.query<WorkspaceRow>(
      `SELECT ${workspaceFields} FROM workspaces
       WHERE owner_user_id = $1 AND type = 'personal' LIMIT 1`,
      [userId],
    );
    const workspace = result.rows[0];
    if (!workspace) throw new NotFoundException("Espace personnel introuvable.");
    return { workspace: toWorkspaceDto(workspace) };
  }

  @Post("personal/ensure")
  async ensurePersonal(@CurrentSession() session: AuthSession | undefined) {
    if (!session) throw new UnauthorizedException();
    const client = await authPool.connect();
    try {
      await client.query("BEGIN");
      const userId = await getDomainUserId(client, session.user.id);
      const workspace = await ensurePersonalWorkspace(client, userId);
      await client.query("COMMIT");
      return { workspace: toWorkspaceDto(workspace) };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  @Patch("personal")
  async updatePersonal(
    @CurrentSession() session: AuthSession | undefined,
    @Body() body: unknown,
  ) {
    if (!session) throw new UnauthorizedException();
    const parsed = workspaceUpdateSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: "Métadonnées d’espace invalides.",
        issues: parsed.error.issues,
      });
    }

    const { name, description, metadata } = parsed.data;
    const client = await authPool.connect();
    try {
      await client.query("BEGIN");
      const userId = await getDomainUserId(client, session.user.id);
      const current = await client.query<WorkspaceRow>(
        `SELECT ${workspaceFields} FROM workspaces
         WHERE owner_user_id = $1 AND type = 'personal' FOR UPDATE`,
        [userId],
      );
      const workspace = current.rows[0];
      if (!workspace) throw new NotFoundException("Espace personnel introuvable.");
      if (workspace.archived_at) {
        throw new ConflictException("Restaurez l’espace personnel avant de le modifier.");
      }

      const updated = await client.query<WorkspaceRow>(
        `UPDATE workspaces
         SET name = COALESCE($1, name),
             description = CASE WHEN $2::boolean THEN $3 ELSE description END,
             metadata = COALESCE($4::jsonb, metadata),
             updated_at = now()
         WHERE id = $5 AND owner_user_id = $6
         RETURNING ${workspaceFields}`,
        [
          name ?? null,
          description !== undefined,
          description ?? null,
          metadata === undefined ? null : JSON.stringify(metadata),
          workspace.id,
          userId,
        ],
      );
      const saved = updated.rows[0];
      if (!saved) throw new NotFoundException("Espace personnel introuvable.");
      await client.query("COMMIT");
      return { workspace: toWorkspaceDto(saved) };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  @Post("personal/archive")
  async archivePersonal(@CurrentSession() session: AuthSession | undefined) {
    return this.setArchived(session, true);
  }

  @Post("personal/restore")
  async restorePersonal(@CurrentSession() session: AuthSession | undefined) {
    return this.setArchived(session, false);
  }

  private async setArchived(session: AuthSession | undefined, archived: boolean) {
    if (!session) throw new UnauthorizedException();
    const client = await authPool.connect();
    try {
      await client.query("BEGIN");
      const userId = await getDomainUserId(client, session.user.id);
      const result = await client.query<WorkspaceRow>(
        `UPDATE workspaces
         SET archived_at = CASE
           WHEN $2::boolean THEN COALESCE(archived_at, now())
           ELSE NULL
         END,
         updated_at = now()
         WHERE owner_user_id = $1 AND type = 'personal'
         RETURNING ${workspaceFields}`,
        [userId, archived],
      );
      const workspace = result.rows[0];
      if (!workspace) throw new NotFoundException("Espace personnel introuvable.");
      await client.query("COMMIT");
      return { workspace: toWorkspaceDto(workspace) };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
