import type { auth } from "../auth/auth.js";
import type { WorkspaceMembershipContext } from "../workspaces/workspace-membership.guard.js";

type AuthSession = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;

declare global {
  namespace Express {
    interface Request {
      authSession?: AuthSession;
      workspaceMembership?: WorkspaceMembershipContext;
    }
  }
}

export {};
