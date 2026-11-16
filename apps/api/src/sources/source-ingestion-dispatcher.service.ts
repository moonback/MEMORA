import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Queue } from "bullmq";
import { Pool } from "pg";
import { ingestionJobId, redisConnectionOptions, SOURCE_INGESTION_QUEUE, type SourceIngestionJobData, retryDelayMs } from "./source-ingestion-queue.js";

interface OutboxRow {
  id: string;
  ingestion_id: string;
  source_id: string;
  workspace_id: string;
  lease_token: string;
  attempts: number;
}

const BATCH_SIZE = 25;

@Injectable()
export class SourceIngestionDispatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SourceIngestionDispatcherService.name);
  private readonly pool: Pool;
  private readonly queue: Queue<SourceIngestionJobData>;
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private readonly pollMs = this.readInt("INGESTION_OUTBOX_POLL_MS", 2000, 250, 60000);
  private readonly leaseSeconds = this.readInt("INGESTION_OUTBOX_LEASE_SECONDS", 60, 10, 900);

  constructor() {
    const databaseUrl = process.env.DATABASE_SYSTEM_URL ?? process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error("DATABASE_SYSTEM_URL or DATABASE_URL is required for the ingestion dispatcher.");
    this.pool = new Pool({ connectionString: databaseUrl, max: 3 });
    this.queue = new Queue<SourceIngestionJobData>(SOURCE_INGESTION_QUEUE, {
      connection: redisConnectionOptions(),
      defaultJobOptions: {
        attempts: this.readInt("INGESTION_MAX_ATTEMPTS", 5, 1, 10),
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: 1000,
        removeOnFail: 1000,
      },
    });
  }

  onModuleInit(): void {
    this.timer = setInterval(() => { void this.runSafely(); }, this.pollMs);
    this.timer.unref?.();
    void this.runSafely();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.queue.close();
    await this.pool.end();
  }

  async dispatchBatch(): Promise<number> {
    const client = await this.pool.connect();
    let rows: OutboxRow[] = [];
    try {
      await client.query("BEGIN");
      const claimed = await client.query<OutboxRow>(
        `WITH candidates AS (
           SELECT id FROM public.source_ingestion_outbox
           WHERE published_at IS NULL AND available_at <= now()
             AND (lease_until IS NULL OR lease_until <= now())
           ORDER BY created_at
           LIMIT $1
           FOR UPDATE SKIP LOCKED
         )
         UPDATE public.source_ingestion_outbox AS o
         SET lease_token = gen_random_uuid(),
             lease_until = now() + ($2 * interval '1 second'),
             attempts = attempts + 1
         FROM candidates c
         WHERE o.id = c.id
         RETURNING o.id, o.ingestion_id, o.source_id, o.workspace_id, o.lease_token, o.attempts`,
        [BATCH_SIZE, this.leaseSeconds],
      );
      rows = claimed.rows;
      await client.query("COMMIT");
    } catch {
      await client.query("ROLLBACK");
      throw new Error("outbox_claim_failed");
    } finally {
      client.release();
    }

    let published = 0;
    for (const row of rows) {
      const data: SourceIngestionJobData = {
        ingestionId: row.ingestion_id,
        sourceId: row.source_id,
        workspaceId: row.workspace_id,
      };
      try {
        await this.queue.add("process-source-ingestion", data, {
          jobId: ingestionJobId(row.ingestion_id),
        });
        await this.pool.query(
          `UPDATE public.source_ingestion_outbox
           SET published_at = now(), lease_token = NULL, lease_until = NULL, last_error_code = NULL
           WHERE id = $1 AND lease_token = $2 AND published_at IS NULL`,
          [row.id, row.lease_token],
        );
        published += 1;
      } catch {
        const delay = retryDelayMs(row.attempts);
        await this.pool.query(
          `UPDATE public.source_ingestion_outbox
           SET lease_token = NULL, lease_until = NULL,
               available_at = now() + ($3 * interval '1 millisecond'),
               last_error_code = 'queue_publish_failed'
           WHERE id = $1 AND lease_token = $2 AND published_at IS NULL`,
          [row.id, row.lease_token, delay],
        );
        this.logger.warn("Ingestion event publication failed; event retained for retry.");
      }
    }
    return published;
  }

  private async runSafely(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try { await this.dispatchBatch(); }
    catch { this.logger.warn("Ingestion outbox polling cycle failed."); }
    finally { this.running = false; }
  }

  private readInt(name: string, fallback: number, min: number, max: number): number {
    const raw = process.env[name];
    if (!raw) return fallback;
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${name} must be between ${min} and ${max}.`);
    return value;
  }
}
