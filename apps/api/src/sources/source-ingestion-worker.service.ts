import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Queue, Worker } from "bullmq";
import type { Job } from "bullmq";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { assertSafeJobData, redisConnectionOptions, SOURCE_INGESTION_QUEUE, type SourceIngestionJobData } from "./source-ingestion-queue.js";
import { SOURCE_INGESTION_PROCESSOR, type SourceIngestionProcessor, PermanentSourceIngestionError } from "./source-ingestion-processor.js";

interface ClaimedIngestion {
  attempts: number;
  max_attempts: number;
  lease_token: string;
}

@Injectable()
export class SourceIngestionWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SourceIngestionWorkerService.name);
  private readonly pool: Pool;
  private readonly queue: Queue<SourceIngestionJobData>;
  private worker?: Worker<SourceIngestionJobData>;
  private recoveryTimer?: ReturnType<typeof setInterval>;
  private recovering = false;
  private readonly leaseSeconds = this.readInt("INGESTION_WORKER_LEASE_SECONDS", 120, 15, 1800);
  private readonly heartbeatMs = this.readInt("INGESTION_WORKER_HEARTBEAT_MS", 30000, 1000, 300000);
  private readonly recoveryMs = this.readInt("INGESTION_RECOVERY_POLL_MS", 15000, 1000, 300000);

  constructor(@Inject(SOURCE_INGESTION_PROCESSOR) private readonly processor: SourceIngestionProcessor) {
    const databaseUrl = process.env.DATABASE_SYSTEM_URL ?? process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error("DATABASE_SYSTEM_URL or DATABASE_URL is required for the ingestion worker.");
    if (this.heartbeatMs >= this.leaseSeconds * 1000) {
      throw new Error("INGESTION_WORKER_HEARTBEAT_MS must be shorter than the worker lease.");
    }
    this.pool = new Pool({ connectionString: databaseUrl, max: 5 });
    this.queue = new Queue<SourceIngestionJobData>(SOURCE_INGESTION_QUEUE, { connection: redisConnectionOptions() });
  }

  onModuleInit(): void {
    this.worker = new Worker<SourceIngestionJobData>(
      SOURCE_INGESTION_QUEUE,
      async (job) => this.processJob(job),
      { connection: redisConnectionOptions(), concurrency: this.readInt("INGESTION_WORKER_CONCURRENCY", 5, 1, 20), lockDuration: this.leaseSeconds * 1000 },
    );
    this.worker.on("error", () => this.logger.warn("Ingestion worker transport error."));
    this.recoveryTimer = setInterval(() => { void this.recoverExpiredLeases(); }, this.recoveryMs);
    this.recoveryTimer.unref?.();
    void this.recoverExpiredLeases();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.recoveryTimer) clearInterval(this.recoveryTimer);
    await this.worker?.close();
    await this.queue.close();
    await this.pool.end();
  }

  private async processJob(job: Job<SourceIngestionJobData>): Promise<void> {
    const data = assertSafeJobData(job.data);
    const leaseToken = randomUUID();
    const claim = await this.pool.query<ClaimedIngestion>(
      `UPDATE public.source_ingestions AS i
       SET status = 'processing', attempts = attempts + 1, lease_token = $4,
           lease_until = now() + ($5 * interval '1 second'), heartbeat_at = now(),
           started_at = COALESCE(started_at, now()), updated_at = now()
       FROM public.sources AS s
       WHERE i.id = $1 AND i.source_id = $2 AND i.workspace_id = $3
         AND s.id = i.source_id AND s.workspace_id = i.workspace_id AND s.status = 'ready'
         AND i.available_at <= now() AND i.attempts < i.max_attempts
         AND (i.status = 'queued' OR (i.status = 'processing' AND i.lease_until <= now()))
       RETURNING i.attempts, i.max_attempts, i.lease_token`,
      [data.ingestionId, data.sourceId, data.workspaceId, leaseToken, this.leaseSeconds],
    );
    const current = claim.rows[0];
    if (!current) return;

    let leaseLost = false;
    const heartbeat = setInterval(() => {
      void this.pool.query(
        `UPDATE public.source_ingestions SET heartbeat_at = now(),
           lease_until = now() + ($4 * interval '1 second'), updated_at = now()
         WHERE id = $1 AND source_id = $2 AND workspace_id = $3
           AND status = 'processing' AND lease_token = $5`,
        [data.ingestionId, data.sourceId, data.workspaceId, this.leaseSeconds, leaseToken],
      ).then((result) => { if (!result.rowCount) leaseLost = true; }).catch(() => { leaseLost = true; });
    }, this.heartbeatMs);
    heartbeat.unref?.();

    try {
      await this.processor.process({ ...data, attempt: current.attempts });
      if (leaseLost) throw new Error("ingestion_lease_lost");
      const completed = await this.pool.query(
        `UPDATE public.source_ingestions
         SET status = 'succeeded', completed_at = now(), lease_token = NULL,
             lease_until = NULL, heartbeat_at = now(), last_error_code = NULL, updated_at = now()
         WHERE id = $1 AND source_id = $2 AND workspace_id = $3
           AND status = 'processing' AND lease_token = $4`,
        [data.ingestionId, data.sourceId, data.workspaceId, leaseToken],
      );
      if (!completed.rowCount) throw new Error("ingestion_lease_lost");
    } catch (error) {
      const permanent = error instanceof PermanentSourceIngestionError;
      const exhausted = current.attempts >= current.max_attempts;
      const code = permanent && error instanceof PermanentSourceIngestionError ? error.code
        : error instanceof Error && error.message === "ingestion_lease_lost" ? "lease_lost"
        : "processor_transient_failure";
      await this.pool.query(
        `UPDATE public.source_ingestions
         SET status = $5, completed_at = CASE WHEN $5 = 'failed' THEN now() ELSE NULL END,
             available_at = CASE WHEN $5 = 'queued' THEN now() ELSE available_at END,
             lease_token = NULL, lease_until = NULL, last_error_code = $6, updated_at = now()
         WHERE id = $1 AND source_id = $2 AND workspace_id = $3
           AND status = 'processing' AND lease_token = $4`,
        [data.ingestionId, data.sourceId, data.workspaceId, leaseToken, permanent || exhausted ? "failed" : "queued", code],
      );
      if (!permanent && !exhausted) throw new Error("source_ingestion_transient_failure");
    } finally {
      clearInterval(heartbeat);
    }
  }

  async recoverExpiredLeases(): Promise<number> {
    if (this.recovering) return 0;
    this.recovering = true;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const recovered = await client.query<{ id: string }>(
        `WITH expired AS (
           SELECT id FROM public.source_ingestions
           WHERE status = 'processing' AND lease_until <= now()
           ORDER BY lease_until LIMIT 25 FOR UPDATE SKIP LOCKED
         ), reset AS (
           UPDATE public.source_ingestions i
           SET status = CASE WHEN i.attempts >= i.max_attempts THEN 'failed' ELSE 'queued' END,
               completed_at = CASE WHEN i.attempts >= i.max_attempts THEN now() ELSE NULL END,
               available_at = now(), lease_token = NULL, lease_until = NULL,
               last_error_code = 'worker_lease_expired', updated_at = now()
           FROM expired e WHERE i.id = e.id
           RETURNING i.id, i.status
         )
         UPDATE public.source_ingestion_outbox o
         SET published_at = NULL, available_at = now(), lease_token = NULL, lease_until = NULL,
             last_error_code = NULL
         FROM reset r
         WHERE r.status = 'queued' AND o.ingestion_id = r.id
         RETURNING o.id`,
      );
      await client.query("COMMIT");
      return recovered.rowCount ?? 0;
    } catch {
      await client.query("ROLLBACK");
      this.logger.warn("Ingestion lease recovery cycle failed.");
      return 0;
    } finally {
      client.release();
      this.recovering = false;
    }
  }

  private readInt(name: string, fallback: number, min: number, max: number): number {
    const raw = process.env[name];
    if (!raw) return fallback;
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${name} must be between ${min} and ${max}.`);
    return value;
  }
}
