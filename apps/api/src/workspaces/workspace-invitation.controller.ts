import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from "@nestjs/common";
import { createInvitationToken, hashInvitationToken } from "./invitation-token.js";
import { z } from "zod";
import { authPool } from "../auth/auth.js";
import { queueAuthEmail } from "../auth/mailer.js";
import { CurrentSession } from "../auth/current-session.decorator.js";
import { CurrentWorkspaceMembership, RequireWorkspaceRoles } from "./workspace-membership.decorator.js";
import { WorkspaceMembershipGuard, type WorkspaceMembershipContext } from "./workspace-membership.guard.js";
import { canInviteRole } from "./workspace-rbac.js";

type AuthSession = {
  user: { id: string; email: string; emailVerified: boolean };
};

export const invitationSchema = z.object({
  email: z.string().trim().email().max(320),
  role: z.enum(["admin", "member", "viewer"]).default("member"),
}).strict();

@Controller("workspaces/:workspaceId/invitations")
@UseGuards(WorkspaceMembershipGuard)
export class WorkspaceInvitationController {
  @Post()
  @RequireWorkspaceRoles("owner", "admin")
  async create(
    @Param("workspaceId") workspaceId: string,
    @CurrentSession() session: AuthSession,
    @CurrentWorkspaceMembership() actor: WorkspaceMembershipContext,
    @Body() body: unknown,
  ) {
    const parsed = invitationSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: "Invitation invalide.",
        issues: parsed.error.issues,
      });
    }
    if (actor.workspaceType !== "shared") throw new BadRequestException("Les invitations sont réservées aux espaces partagés.");
    const email = parsed.data.email.toLowerCase();
    const role = parsed.data.role;
    if (email === session.user.email.toLowerCase()) {
      throw new BadRequestException("Vous ne pouvez pas vous inviter vous-même.");
    }
    if (!canInviteRole(actor.role, role)) {
      throw new ForbiddenException("Votre rôle ne permet pas d'inviter ce niveau de permission.");
    }

    const client = await authPool.connect();
    let saved: { id: string; email: string; role: string; expires_at: Date } | undefined;
    try {
      await client.query("BEGIN");
      const actorResult = await client.query<{ role: "owner" | "admin" | "member" | "viewer" }>(
        "SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 AND status = 'active' FOR UPDATE",
        [workspaceId, actor.userId],
      );
      const currentActor = actorResult.rows[0];
      if (!currentActor || !canInviteRole(currentActor.role, role)) {
        throw new ForbiddenException("Votre rôle ne permet pas cette invitation.");
      }
      const existingMember = await client.query(
        `SELECT wm.user_id FROM workspace_members wm
         JOIN users u ON u.id = wm.user_id
         WHERE wm.workspace_id = $1 AND lower(u.email) = $2 AND wm.status = 'active'
         LIMIT 1`,
        [workspaceId, email],
      );
      if (existingMember.rows[0]) throw new ConflictException("Cette personne est déjà membre de l’espace.");

      const invitation = await client.query<{ id: string; email: string; role: string; expires_at: Date }>(
        `INSERT INTO workspace_invitations
           (workspace_id, email, role, token_hash, expires_at, invited_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (workspace_id, email) WHERE accepted_at IS NULL
         DO UPDATE SET role = EXCLUDED.role, token_hash = EXCLUDED.token_hash,
                       expires_at = EXCLUDED.expires_at, invited_by_user_id = EXCLUDED.invited_by_user_id,
                       updated_at = now()
         RETURNING id, email, role, expires_at`,
        [workspaceId, email, role, tokenHash, expiresAt, actor.userId],
      );
      saved = invitation.rows[0];
      if (!saved) throw new Error("Invitation could not be persisted.");
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    if (!saved) throw new Error("Invitation could not be persisted.");
    const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:3000";
    const url = `${webOrigin}/invite/accept?token=${encodeURIComponent(token)}`;
    queueAuthEmail({
      to: email,
      subject: "Vous êtes invité à rejoindre un espace MEMORA",
      text: `Vous avez été invité à rejoindre un espace MEMORA. Connectez-vous avec cette adresse e-mail puis acceptez l'invitation : ${url}`,
    });

    return {
      invitation: {
        id: saved.id,
        email: saved.email,
        role: saved.role,
        expiresAt: saved.expires_at,
      },
    };
  }

  @Get()
  @RequireWorkspaceRoles("owner", "admin")
  async list(
    @Param("workspaceId") workspaceId: string,
    @CurrentWorkspaceMembership() actor: WorkspaceMembershipContext,
  ) {
    if (actor.workspaceType !== "shared") throw new BadRequestException("Les invitations sont réservées aux espaces partagés.");
    const result = await authPool.query<{
      id: string;
      email: string;
      role: string;
      expiresAt: Date;
      acceptedAt: Date | null;
      invitedAt: Date;
      status: string;
    }>(
      `SELECT id, email, role, expires_at AS "expiresAt",
              accepted_at AS "acceptedAt", created_at AS "invitedAt",
              CASE WHEN accepted_at IS NOT NULL THEN 'accepted'
                   WHEN expires_at <= now() THEN 'expired'
                   ELSE 'pending' END AS status
       FROM workspace_invitations
       WHERE workspace_id = $1
       ORDER BY created_at DESC`,
      [workspaceId],
    );
    return { invitations: result.rows };
  }

  @Delete(":invitationId")
  @RequireWorkspaceRoles("owner", "admin")
  async revoke(
    @Param("workspaceId") workspaceId: string,
    @Param("invitationId", new ParseUUIDPipe()) invitationId: string,
    @CurrentWorkspaceMembership() actor: WorkspaceMembershipContext,
  ) {
    if (actor.workspaceType !== "shared") throw new BadRequestException("Les invitations sont réservées aux espaces partagés.");
    const current = await authPool.query<{ role: string }>(
      `SELECT role FROM workspace_invitations
       WHERE id = $1 AND workspace_id = $2 AND accepted_at IS NULL`,
      [invitationId, workspaceId],
    );
    const invitation = current.rows[0];
    if (!invitation) throw new NotFoundException("Invitation en attente introuvable.");
    if (actor.role === "admin" && invitation.role === "admin") {
      throw new ForbiddenException("Un administrateur ne peut pas révoquer une invitation d'administrateur.");
    }
    await authPool.query(
      "DELETE FROM workspace_invitations WHERE id = $1 AND workspace_id = $2 AND accepted_at IS NULL",
      [invitationId, workspaceId],
    );
    return { success: true };
  }
}

@Controller("invitations")
export class InvitationAcceptanceController {
  @Post("accept")
  async accept(
    @CurrentSession() session: AuthSession,
    @Body() body: unknown,
  ) {
    if (!session.user.emailVerified) {
      throw new ForbiddenException("Confirmez votre adresse e-mail avant d'accepter une invitation.");
    }
    const parsed = z.object({ token: z.string().min(32).max(128) }).strict().safeParse(body);
    if (!parsed.success) throw new BadRequestException("Jeton d'invitation invalide.");

    const tokenHash = hashInvitationToken(parsed.data.token);
    const client = await authPool.connect();
    try {
      await client.query("BEGIN");
      const invitationResult = await client.query<{
        id: string;
        workspace_id: string;
        email: string;
        role: "admin" | "member" | "viewer";
        expires_at: Date;
        accepted_at: Date | null;
        workspace_name: string;
        archived_at: Date | null;
      }>(
        `SELECT i.id, i.workspace_id, i.email, i.role, i.expires_at, i.accepted_at,
                w.name AS workspace_name, w.archived_at
         FROM workspace_invitations i
         JOIN workspaces w ON w.id = i.workspace_id
         WHERE i.token_hash = $1
         FOR UPDATE OF i`,
        [tokenHash],
      );
      const invitation = invitationResult.rows[0];
      if (!invitation) throw new NotFoundException("Invitation invalide ou introuvable.");
      if (invitation.accepted_at) throw new ConflictException("Cette invitation a déjà été utilisée.");
      if (invitation.expires_at.getTime() <= Date.now()) {
        throw new ConflictException("Cette invitation a expiré.");
      }
      if (invitation.archived_at) throw new ConflictException("Cet espace est archivé.");
      if (invitation.email.toLowerCase() !== session.user.email.toLowerCase()) {
        throw new ForbiddenException("Connectez-vous avec l'adresse e-mail qui a reçu l'invitation.");
      }

      const userResult = await client.query<{ id: string }>(
        "SELECT id FROM users WHERE auth_user_id = $1 LIMIT 1",
        [session.user.id],
      );
      const user = userResult.rows[0];
      if (!user) throw new NotFoundException("Profil MEMORA introuvable.");

      await client.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role, status, joined_at)
         VALUES ($1, $2, $3, 'active', now())
         ON CONFLICT (workspace_id, user_id) DO UPDATE
           SET role = EXCLUDED.role, status = 'active', joined_at = now(), updated_at = now()`,
        [invitation.workspace_id, user.id, invitation.role],
      );
      await client.query(
        "UPDATE workspace_invitations SET accepted_at = now(), updated_at = now() WHERE id = $1",
        [invitation.id],
      );
      await client.query("COMMIT");
      return {
        success: true,
        workspace: { id: invitation.workspace_id, name: invitation.workspace_name },
        role: invitation.role,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
