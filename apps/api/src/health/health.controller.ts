import { Controller, Get } from "@nestjs/common";
import { Public } from "../auth/public.decorator.js";
import { getReadiness } from "./health.checks.js";

@Controller()
export class HealthController {
  @Public()
  @Get("health")
  health() {
    return {
      status: "ok" as const,
      service: "memora-api",
      timestamp: new Date().toISOString(),
    };
  }

  @Public()
  @Get("health/ready")
  readiness() {
    return getReadiness();
  }
}
