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
  Patch,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";
import { authPool } from "../auth/auth.js";
import { withWorkspaceContext } from "../database/tenant-context.js";
import { CurrentWorkspaceMembership, RequireWorkspaceRoles } from "./workspace-membership.decorator.js";
import { WorkspaceMembershipGuard, type WorkspaceMembershipContext, type WorkspaceRole } from "./workspace-membership.guard.js";
import { canChangeMemberRole, canLeaveWorkspace, canRemoveMember } from "./workspace-rbac.js";

export const roleUpdateSchema = z.object({
  role: z.enum(["admin", "member", "viewer"]),
}).strict();

@Controller("workspaces/:workspaceId/members")
@UseGuards(WorkspaceMembershipGuard)
export class WorkspaceMembershipController {
  @Get()
  async list(
    @Param("workspaceId") workspaceId: string,
    @CurrentWorkspaceMembership() actor: WorkspaceMembershipContext,
  ) {
    return withWorkspaceContext(authPool, actor.authUserId, workspaceId, async (client, { membership }) => {
      const result = await client.query<{
        userId: string;
        email: string;
        displayName: string | null;
        role: string;
        status: string;
        joinedAt: Date | null;
      }>(
        `SELECT wm.user_id AS "userId", u.email, u.display_name AS "displayName",
                wm.role, wm.status, wm.joined_at AS "joinedAt"
         FROM workspace_members wm
         JOIN users u ON u.id = wm.user_id
         WHERE wm.workspace_id = $1 AND wm.status = 'active'
         ORDER BY CASE wm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'member' THEN 2 ELSE 3 END,
                  wm.joined_at ASC NULLS LAST`,
        [workspaceId],
      );
      return { workspaceId: membership.workspaceId, members: result.rows };
    });
  }

  @Patch(":memberUserId")
  @RequireWorkspaceRoles("owner", "admin")
  async updateRole(
    @Param("workspaceId") workspaceId: string,
    @Param("memberUserId", new ParseUUIDPipe()) memberUserId: string,
    @CurrentWorkspaceMembership() actor: WorkspaceMembershipContext,
    @Body() body: unknown,
  ) {
    const parsed = roleUpdateSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ message: "Rôle invalide.", issues: parsed.error.issues });
    }

    return withWorkspaceContext(authPool, actor.authUserId, workspaceId, async (client, { membership }) => {
      const actorResult = await client.query<{ role: WorkspaceRole }>(
        "SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 AND status = 'active' FOR UPDATE",
        [workspaceId, membership.userId],
      );
      const currentActor = actorResult.rows[0];
      if (!currentActor) throw new ForbiddenException("Votre accès à cet espace a changé.");
      const targetResult = await client.query<{ role: WorkspaceRole }>(
        "SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 AND status = 'active' FOR UPDATE",
        [workspaceId, memberUserId],
      );
      const target = targetResult.rows[0];
      if (!target) throw new NotFoundException("Membre introuvable.");
      if (!canChangeMemberRole(currentActor.role, target.role, parsed.data.role)) {
        throw new ForbiddenException("Votre rôle ne permet pas de modifier ce membre.");
      }
      const updated = await client.query<{ user_id: string; role: string }>(
        `UPDATE workspace_members SET role = $1, updated_at = now()
         WHERE workspace_id = $2 AND user_id = $3 AND status = 'active'
         RETURNING user_id, role`,
        [parsed.data.role, workspaceId, memberUserId],
      );
      return { member: updated.rows[0] };
    });
  }

  @Delete("me")
  async leave(
    @Param("workspaceId") workspaceId: string,
    @CurrentWorkspaceMembership() actor: WorkspaceMembershipContext,
  ) {
    return withWorkspaceContext(authPool, actor.authUserId, workspaceId, async (client, { membership }) => {
      const current = await client.query<{ role: WorkspaceRole }>(
        "SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 AND status = 'active' FOR UPDATE",
        [workspaceId, membership.userId],
      );
      const currentMembership = current.rows[0];
      if (!currentMembership) throw new ForbiddenException("Votre accès à cet espace a changé.");
      if (!canLeaveWorkspace(currentMembership.role)) {
        throw new ConflictException("Le propriétaire doit transférer la propriété avant de quitter l’espace.");
      }
      await client.query("DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2", [workspaceId, membership.userId]);
      return { success: true };
    });
  }

  @Delete(":memberUserId")
  @RequireWorkspaceRoles("owner", "admin")
  async remove(
    @Param("workspaceId") workspaceId: string,
    @Param("memberUserId", new ParseUUIDPipe()) memberUserId: string,
    @CurrentWorkspaceMembership() actor: WorkspaceMembershipContext,
  ) {
    return withWorkspaceContext(authPool, actor.authUserId, workspaceId, async (client, { membership }) => {
      const actorResult = await client.query<{ role: WorkspaceRole }>(
        "SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 AND status = 'active' FOR UPDATE",
        [workspaceId, membership.userId],
      );
      const currentActor = actorResult.rows[0];
      if (!currentActor) throw new ForbiddenException("Votre accès à cet espace a changé.");
      const target = await client.query<{ role: WorkspaceRole }>(
        "SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 AND status = 'active' FOR UPDATE",
        [workspaceId, memberUserId],
      );
      const targetRole = target.rows[0]?.role;
      if (!targetRole) throw new NotFoundException("Membre introuvable.");
      if (!canRemoveMember(currentActor.role, targetRole)) {
        throw new ForbiddenException("Votre rôle ne permet pas de retirer ce membre.");
      }
      await client.query("DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2", [workspaceId, memberUserId]);
      return { success: true };
    });
  }
}
