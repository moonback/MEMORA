import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AccountController } from "./auth/account.controller.js";
import { AuthGuard } from "./auth/auth.guard.js";
import { HealthController } from "./health/health.controller.js";

@Module({
  imports: [],
  controllers: [HealthController, AccountController],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
