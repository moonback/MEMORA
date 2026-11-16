import { createConnection } from "node:net";

export type DependencyState = "ok" | "unavailable" | "unconfigured";

export interface DependencyCheck {
  status: DependencyState;
  latencyMs?: number;
  message?: string;
}

export interface ReadinessResponse {
  status: "ok" | "degraded";
  service: "memora-api";
  timestamp: string;
  dependencies: {
    database: DependencyCheck;
    redis: DependencyCheck;
  };
}

type TcpProbe = (url: string, timeoutMs?: number) => Promise<DependencyCheck>;

export const probeTcp: TcpProbe = (rawUrl, timeoutMs = 1_500) =>
  new Promise((resolve) => {
    let target: URL;
    try {
      target = new URL(rawUrl);
    } catch {
      resolve({ status: "unavailable", message: "Invalid connection URL" });
      return;
    }

    const startedAt = Date.now();
    const socket = createConnection({
      host: target.hostname,
      port: Number(target.port || (target.protocol === "redis:" ? 6379 : 5432)),
    });
    let settled = false;

    const finish = (result: DependencyCheck) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () =>
      finish({ status: "ok", latencyMs: Date.now() - startedAt }),
    );
    socket.once("timeout", () =>
      finish({ status: "unavailable", message: "Connection timed out" }),
    );
    socket.once("error", (error: NodeJS.ErrnoException) =>
      finish({
        status: "unavailable",
        message: error.code ?? "Connection failed",
      }),
    );
  });

export async function getReadiness(
  env: NodeJS.ProcessEnv = process.env,
  probe: TcpProbe = probeTcp,
): Promise<ReadinessResponse> {
  const databaseUrl = env.DATABASE_URL;
  const redisUrl = env.REDIS_URL;

  const [database, redis] = await Promise.all([
    databaseUrl
      ? probe(databaseUrl)
      : Promise.resolve<DependencyCheck>({
          status: "unconfigured",
          message: "DATABASE_URL is not configured",
        }),
    redisUrl
      ? probe(redisUrl)
      : Promise.resolve<DependencyCheck>({
          status: "unconfigured",
          message: "REDIS_URL is not configured",
        }),
  ]);

  return {
    status:
      database.status === "ok" && redis.status === "ok" ? "ok" : "degraded",
    service: "memora-api",
    timestamp: new Date().toISOString(),
    dependencies: { database, redis },
  };
}
