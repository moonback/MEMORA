import {
  CanActivate,
  ConflictException,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { authPool } from "../auth/auth.js";

export type WorkspaceRole = "owner" | "admin" | "member" | "viewer";
export interface WorkspaceMembershipContext {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  workspaceType: "personal" | "shared";
}

export const WORKSPACE_ROLES_KEY = "memora:workspace-roles";

declare module "express-serve-static-core" {
  interface Request {
    workspaceMembership?: WorkspaceMembershipContext;
  }
}

@Injectable()
export class WorkspaceMembershipGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const session = request.authSession;
    const workspaceId = request.params.workspaceId;
    if (!session || !workspaceId) throw new ForbiddenException("Contexte de session ou d’espace manquant.");

    const result = await authPool.query<{
      user_id: string;
      role: WorkspaceRole;
      archived_at: Date | null;
      workspace_type: "personal" | "shared";
    }>(
      `SELECT wm.user_id, wm.role, w.archived_at, w.type AS workspace_type
       FROM workspace_members wm
       JOIN workspaces w ON w.id = wm.workspace_id
       JOIN users u ON u.id = wm.user_id
       WHERE wm.workspace_id = $1
         AND u.auth_user_id = $2
         AND wm.status = 'active'
       LIMIT 1`,
      [workspaceId, session.user.id],
    );
    const membership = result.rows[0];
    if (!membership) throw new ForbiddenException("Vous n'êtes pas membre de cet espace.");
    if (membership.archived_at) throw new ConflictException("Cet espace est archivé.");

    const allowedRoles = this.reflector.getAllAndOverride<WorkspaceRole[]>(WORKSPACE_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowedRoles?.length && !allowedRoles.includes(membership.role)) {
      throw new ForbiddenException("Votre rôle ne permet pas cette opération.");
    }

    request.workspaceMembership = {
      workspaceId,
      userId: membership.user_id,
      role: membership.role,
      workspaceType: membership.workspace_type,
    };
    return true;
  }
}
