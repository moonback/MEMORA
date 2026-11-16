import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AccountController } from "./auth/account.controller.js";
import { AuthGuard } from "./auth/auth.guard.js";
import { HealthController } from "./health/health.controller.js";
import { WorkspaceController } from "./workspaces/workspace.controller.js";
import { WorkspaceMembershipController } from "./workspaces/workspace-membership.controller.js";
import { WorkspaceInvitationController, InvitationAcceptanceController } from "./workspaces/workspace-invitation.controller.js";
import { WorkspaceMembershipGuard } from "./workspaces/workspace-membership.guard.js";
import { SourceController } from "./sources/source.controller.js";
import { MemoryController } from "./memories/memory.controller.js";
import { EntityController } from "./entities/entity.controller.js";

@Module({
  imports: [],
  controllers: [HealthController, AccountController, WorkspaceController, WorkspaceMembershipController, WorkspaceInvitationController, InvitationAcceptanceController, SourceController, MemoryController, EntityController],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    WorkspaceMembershipGuard,
  ],
})
export class AppModule {}
