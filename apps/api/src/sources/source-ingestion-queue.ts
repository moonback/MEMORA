export const SOURCE_INGESTION_QUEUE = "source-ingestion";

export interface SourceIngestionJobData {
  ingestionId: string;
  sourceId: string;
  workspaceId: string;
}

export function redisConnectionOptions() {
  const raw = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("REDIS_URL is invalid."); }
  if (url.protocol !== "redis:" && url.protocol !== "rediss:") throw new Error("REDIS_URL must use redis:// or rediss://.");
  const db = url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0;
  if (!Number.isSafeInteger(db) || db < 0) throw new Error("REDIS_URL database index is invalid.");
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    db,
    ...(url.protocol === "rediss:" ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
  };
}

export function ingestionJobId(ingestionId: string): string {
  return `source-ingestion-${ingestionId}`;
}

export function assertSafeJobData(value: unknown): SourceIngestionJobData {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid ingestion job payload.");
  const data = value as Record<string, unknown>;
  const keys = Object.keys(data).sort();
  if (keys.join(",") !== "ingestionId,sourceId,workspaceId" ||
      ![data.ingestionId, data.sourceId, data.workspaceId].every((item) => typeof item === "string" && /^[0-9a-f-]{36}$/i.test(item))) {
    throw new Error("Invalid ingestion job payload.");
  }
  return { ingestionId: data.ingestionId as string, sourceId: data.sourceId as string, workspaceId: data.workspaceId as string };
}

export function retryDelayMs(attempt: number): number {
  const safeAttempt = Math.max(1, Math.min(8, Math.floor(attempt)));
  return Math.min(300_000, 2_000 * (2 ** (safeAttempt - 1)));
}
