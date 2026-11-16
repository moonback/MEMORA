import type { WorkspaceRole } from "./workspace-membership.guard.js";

export function canInviteRole(actorRole: WorkspaceRole, invitedRole: "admin" | "member" | "viewer"): boolean {
  if (actorRole === "owner") return true;
  return actorRole === "admin" && invitedRole !== "admin";
}

export function canChangeMemberRole(
  actorRole: WorkspaceRole,
  targetRole: WorkspaceRole,
  nextRole: "admin" | "member" | "viewer",
): boolean {
  if (targetRole === "owner") return false;
  if (actorRole === "owner") return true;
  return actorRole === "admin"
    && (targetRole === "member" || targetRole === "viewer")
    && (nextRole === "member" || nextRole === "viewer");
}

export function canRemoveMember(actorRole: WorkspaceRole, targetRole: WorkspaceRole): boolean {
  if (targetRole === "owner") return false;
  if (actorRole === "owner") return true;
  return actorRole === "admin" && (targetRole === "member" || targetRole === "viewer");
}

export function canLeaveWorkspace(role: WorkspaceRole): boolean {
  return role !== "owner";
}
