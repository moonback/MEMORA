import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { S3ObjectStorageService } from "./object-storage.service.js";

const CLEANUP_INTERVAL_MS = 60_000;
const CLEANUP_BATCH_SIZE = 25;
const CLEANUP_LEASE_SECONDS = 300;

interface ExpiredObject {
  id: string;
  workspace_id: string;
  bucket_name: string;
  object_key: string;
  lease_token: string;
}

/**
 * Periodic in-process worker. PostgreSQL leases and SKIP LOCKED coordinate API replicas.
 * S3 deletion is always outside the claim transaction and can safely be retried.
 */
@Injectable()
export class ObjectUploadCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ObjectUploadCleanupService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private pool: Pool;

  constructor(private readonly storage: S3ObjectStorageService) {
    const connectionString = process.env.DATABASE_SYSTEM_URL ?? process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_SYSTEM_URL or DATABASE_URL is required for object cleanup.");
    this.pool = new Pool({ connectionString, max: 2 });
  }

  onModuleInit(): void {
    this.timer = setInterval(() => { void this.runSafely(); }, CLEANUP_INTERVAL_MS);
    this.timer.unref?.();
    void this.runSafely();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.pool.end();
  }

  async runCleanupBatch(workspaceId?: string): Promise<number> {
    const client = await this.pool.connect();
    let claimed: ExpiredObject[] = [];
    try {
      await client.query("BEGIN");
      const candidates = await client.query<Omit<ExpiredObject, "lease_token">>(
        `SELECT id, workspace_id, bucket_name, object_key
         FROM source_objects
         WHERE status = 'pending' AND expires_at <= now()
           AND ($2::uuid IS NULL OR workspace_id = $2)
           AND (cleanup_lease_until IS NULL OR cleanup_lease_until <= now())
           AND (verification_lease_until IS NULL OR verification_lease_until <= now())
         ORDER BY expires_at
         LIMIT $1
         FOR UPDATE SKIP LOCKED`,
        [CLEANUP_BATCH_SIZE, workspaceId ?? null],
      );
      for (const candidate of candidates.rows) {
        const leaseToken = randomUUID();
        const updated = await client.query(
          `UPDATE source_objects SET cleanup_lease_token = $2,
             cleanup_lease_until = now() + ($3 * interval '1 second'), updated_at = now()
           WHERE id = $1 AND status = 'pending' RETURNING id`,
          [candidate.id, leaseToken, CLEANUP_LEASE_SECONDS],
        );
        if (updated.rowCount) claimed.push({ ...candidate, lease_token: leaseToken });
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    let completed = 0;
    for (const object of claimed) {
      try {
        // S3 DeleteObject is idempotent. No PostgreSQL transaction or row lock is held here.
        await this.storage.deleteObject({ bucketName: object.bucket_name, objectKey: object.object_key });
        await this.pool.query(
          `UPDATE source_objects SET status = 'deleted', cleanup_lease_token = NULL,
             cleanup_lease_until = NULL, cleanup_last_error = NULL, updated_at = now()
           WHERE id = $1 AND workspace_id = $2 AND status = 'pending'
             AND cleanup_lease_token = $3 AND expires_at <= now()`,
          [object.id, object.workspace_id, object.lease_token],
        );
        completed += 1;
      } catch {
        // Persist only a fixed category, never provider diagnostics, object coordinates or content.
        await this.pool.query(
          `UPDATE source_objects SET cleanup_lease_token = NULL, cleanup_lease_until = NULL,
             cleanup_attempts = cleanup_attempts + 1, cleanup_last_error = 'storage_delete_failed',
             updated_at = now()
           WHERE id = $1 AND workspace_id = $2 AND status = 'pending' AND cleanup_lease_token = $3`,
          [object.id, object.workspace_id, object.lease_token],
        );
      }
    }
    return completed;
  }

  private async runSafely(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try { await this.runCleanupBatch(); }
    catch { this.logger.warn("Object upload cleanup cycle failed."); }
    finally { this.running = false; }
  }
}
