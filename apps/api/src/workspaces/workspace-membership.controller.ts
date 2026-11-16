import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  UseGuards,
  ForbiddenException,
} from "@nestjs/common";
import { z } from "zod";
import { authPool } from "../auth/auth.js";
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
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipContext,
  ) {
    const result = await authPool.query<{
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
       WHERE wm.workspace_id = $1
       ORDER BY CASE wm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'member' THEN 2 ELSE 3 END,
                wm.joined_at ASC NULLS LAST`,
      [workspaceId],
    );
    return {
      workspaceId: membership.workspaceId,
      members: result.rows,
    };
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
      throw new BadRequestException({
        message: "Rôle invalide.",
        issues: parsed.error.issues,
      });
    }

    const client = await authPool.connect();
    try {
      await client.query("BEGIN");
      const actorResult = await client.query<{ role: WorkspaceRole }>(
        "SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 AND status = 'active' FOR UPDATE",
        [workspaceId, actor.userId],
      );
      const currentActor = actorResult.rows[0];
      if (!currentActor) throw new ForbiddenException("Votre accès à cet espace a changé.");
      const targetResult = await client.query<{ role: WorkspaceRole }>(
        "SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 FOR UPDATE",
        [workspaceId, memberUserId],
      );
      const target = targetResult.rows[0];
      if (!target) throw new NotFoundException("Membre introuvable.");
      if (!canChangeMemberRole(currentActor.role, target.role, parsed.data.role)) {
        throw new ForbiddenException("Votre rôle ne permet pas de modifier ce membre.");
      }

      const updated = await client.query<{ user_id: string; role: string }>(
        `UPDATE workspace_members SET role = $1, updated_at = now()
         WHERE workspace_id = $2 AND user_id = $3
         RETURNING user_id, role`,
        [parsed.data.role, workspaceId, memberUserId],
      );
      await client.query("COMMIT");
      return { member: updated.rows[0] };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  @Delete("me")
  async leave(
    @Param("workspaceId") workspaceId: string,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipContext,
  ) {
    if (!canLeaveWorkspace(membership.role)) {
      throw new ConflictException("Le propriétaire doit transférer la propriété avant de quitter l’espace.");
    }
    await authPool.query(
      "DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2",
      [workspaceId, membership.userId],
    );
    return { success: true };
  }

  @Delete(":memberUserId")
  @RequireWorkspaceRoles("owner", "admin")
  async remove(
    @Param("workspaceId") workspaceId: string,
    @Param("memberUserId", new ParseUUIDPipe()) memberUserId: string,
    @CurrentWorkspaceMembership() actor: WorkspaceMembershipContext,
  ) {
    const client = await authPool.connect();
    try {
      await client.query("BEGIN");
      const actorResult = await client.query<{ role: WorkspaceRole }>(
        "SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 AND status = 'active' FOR UPDATE",
        [workspaceId, actor.userId],
      );
      const currentActor = actorResult.rows[0];
      if (!currentActor) throw new ForbiddenException("Votre accès à cet espace a changé.");
      const target = await client.query<{ role: WorkspaceRole }> (
        "SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 FOR UPDATE",
        [workspaceId, memberUserId],
      );
      const targetRole = target.rows[0]?.role;
      if (!targetRole) throw new NotFoundException("Membre introuvable.");
      if (!canRemoveMember(currentActor.role, targetRole)) {
        throw new ForbiddenException("Votre rôle ne permet pas de retirer ce membre.");
      }
      await client.query("DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2", [workspaceId, memberUserId]);
      await client.query("COMMIT");
      return { success: true };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
