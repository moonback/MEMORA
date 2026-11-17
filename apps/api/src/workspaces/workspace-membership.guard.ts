import {
  Inject,
  BadRequestException,
  CanActivate,
  ConflictException,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { z } from "zod";
import { authPool } from "../auth/auth.js";
import { withWorkspaceContext, type TenantMembership } from "../database/tenant-context.js";

export type WorkspaceRole = "owner" | "admin" | "member" | "viewer";
export interface WorkspaceMembershipContext {
  workspaceId: string;
  authUserId: string;
  userId: string;
  role: WorkspaceRole;
  workspaceType: "personal" | "shared";
}

export const WORKSPACE_ROLES_KEY = "memora:workspace-roles";

@Injectable()
export class WorkspaceMembershipGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const session = request.authSession;
    const workspaceId = request.params.workspaceId;
    if (!session || typeof workspaceId !== "string" || !workspaceId) throw new ForbiddenException("Contexte de session ou d’espace manquant.");
    if (!z.string().uuid().safeParse(workspaceId).success) throw new BadRequestException("Identifiant d’espace invalide.");

    const membership = await withWorkspaceContext<TenantMembership>(
      authPool,
      session.user.id,
      workspaceId,
      async (_client, tenantContext) => tenantContext.membership,
    );

    const allowedRoles = this.reflector.getAllAndOverride<WorkspaceRole[]>(WORKSPACE_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowedRoles?.length && !allowedRoles.includes(membership.role)) {
      throw new ForbiddenException("Votre rôle ne permet pas cette opération.");
    }

    request.workspaceMembership = {
      workspaceId,
      authUserId: session.user.id,
      userId: membership.userId,
      role: membership.role,
      workspaceType: membership.workspaceType,
    };
    return true;
  }
}
