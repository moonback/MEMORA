import { Controller, Get } from "@nestjs/common";

@Controller()
export class HealthController {
  @Get("health")
  health() {
    return { status: "ok", service: "memora-api", timestamp: new Date().toISOString() };
  }
}
