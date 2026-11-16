import { Controller, Get } from "@nestjs/common";
import { getReadiness } from "./health.checks";

@Controller()
export class HealthController {
  @Get("health")
  health() {
    return {
      status: "ok" as const,
      service: "memora-api",
      timestamp: new Date().toISOString(),
    };
  }

  @Get("health/ready")
  readiness() {
    return getReadiness();
  }
}
