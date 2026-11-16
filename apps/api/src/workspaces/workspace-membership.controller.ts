import {
  BadRequestException,
  ConflictException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  UseGuards,
  ForbiddenException,
} from "@nestjs/common";
import { z } from "zod";
import { authPool } from "../auth/auth.js";
import { CurrentWorkspaceMembership, RequireWorkspaceRoles } from "./workspace-membership.decorator.js";
import { WorkspaceMembershipGuard, type WorkspaceMembershipContext } from "./workspace-membership.guard.js";

const roleUpdateSchema = z.object({
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
    @Param("memberUserId") memberUserId: string,
    @CurrentWorkspaceMembership() actor: WorkspaceMembershipContext,
    body: unknown,
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
      const targetResult = await client.query<{ role: string }>(
        "SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 FOR UPDATE",
        [workspaceId, memberUserId],
      );
      const target = targetResult.rows[0];
      if (!target) throw new NotFoundException("Membre introuvable.");
      if (target.role === "owner") throw new ConflictException("Le rôle du propriétaire ne peut pas être modifié.");
      if (actor.role === "admin" && (target.role === "admin" || parsed.data.role === "admin")) {
        throw new ForbiddenException("Un administrateur ne peut gérer que les membres et lecteurs.");
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
    if (membership.role === "owner") {
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
    @Param("memberUserId") memberUserId: string,
    @CurrentWorkspaceMembership() actor: WorkspaceMembershipContext,
  ) {
    const target = await authPool.query<{ role: string }>(
      "SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2",
      [workspaceId, memberUserId],
    );
    const targetRole = target.rows[0]?.role;
    if (!targetRole) throw new NotFoundException("Membre introuvable.");
    if (targetRole === "owner") throw new ConflictException("Le propriétaire ne peut pas être supprimé.");
    if (actor.role === "admin" && targetRole !== "member" && targetRole !== "viewer") {
      throw new ForbiddenException("Un administrateur ne peut retirer que les membres et lecteurs.");
    }
    await authPool.query(
      "DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2",
      [workspaceId, memberUserId],
    );
    return { success: true };
  }
}
