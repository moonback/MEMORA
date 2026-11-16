import { createParamDecorator, ExecutionContext, SetMetadata } from "@nestjs/common";
import type { Request } from "express";
import type { WorkspaceMembershipContext, WorkspaceRole } from "./workspace-membership.guard.js";

export const RequireWorkspaceRoles = (...roles: WorkspaceRole[]) =>
  SetMetadata("memora:workspace-roles", roles);

export const CurrentWorkspaceMembership = createParamDecorator(
  (_data: unknown, context: ExecutionContext): WorkspaceMembershipContext | undefined => {
    const request = context.switchToHttp().getRequest<Request>();
    return request.workspaceMembership;
  },
);
