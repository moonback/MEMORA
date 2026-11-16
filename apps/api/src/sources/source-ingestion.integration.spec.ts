import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { Queue } from "bullmq";
import { SourceIngestionDispatcherService } from "./source-ingestion-dispatcher.service.js";
import { SourceIngestionWorkerService } from "./source-ingestion-worker.service.js";
import {
  PermanentSourceIngestionError,
  type SourceIngestionContext,
  type SourceIngestionProcessor,
} from "./source-ingestion-processor.js";
import {
  ingestionJobId,
  redisConnectionOptions,
  SOURCE_INGESTION_QUEUE,
} from "./source-ingestion-queue.js";

const databaseUrl = process.env.DATABASE_SYSTEM_URL ?? process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;

const waitFor = async <T>(
  read: () => Promise<T>,
  predicate: (value: T) => boolean,
  description: string,
  timeoutMs = 30_000,
): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  let lastValue: T;
  do {
    lastValue = await read();
    if (predicate(lastValue)) return lastValue;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  assert.fail(`Timed out waiting for ${description}. Last value: ${JSON.stringify(lastValue!)}`);
};

describe(
  "MEM-024 real PostgreSQL + Redis/BullMQ source ingestion",
  { skip: !databaseUrl || !redisUrl, timeout: 90_000 },
  () => {
    const suffix = randomUUID();
    const admin = new Pool({ connectionString: databaseUrl, max: 5 });
    const queue = new Queue(SOURCE_INGESTION_QUEUE, { connection: redisConnectionOptions() });
    const permanentIds = new Set<string>();
    const transientIds = new Set<string>();
    const processorCalls = new Map<string, number>();
    let userId = "";
    let workspaceId = "";
    let dispatcher: SourceIngestionDispatcherService;
    let secondDispatcher: SourceIngestionDispatcherService;
    let worker: SourceIngestionWorkerService;
    const ingestionIds: string[] = [];
    const sourceIds: string[] = [];

    const processor: SourceIngestionProcessor = {
      async process(context: SourceIngestionContext): Promise<void> {
        const calls = (processorCalls.get(context.ingestionId) ?? 0) + 1;
        processorCalls.set(context.ingestionId, calls);
        if (permanentIds.has(context.ingestionId)) {
          throw new PermanentSourceIngestionError("unsupported_source");
        }
        if (transientIds.has(context.ingestionId) && calls === 1) {
          throw new Error("temporary processor failure");
        }
      },
    };

    const createReadySource = async (title: string): Promise<{ sourceId: string; ingestionId: string }> => {
      const source = await admin.query<{ id: string }>(
        `INSERT INTO public.sources
          (workspace_id, created_by_user_id, type, status, title)
         VALUES ($1, $2, 'manual', 'pending', $3)
         RETURNING id`,
        [workspaceId, userId, title],
      );
      const sourceId = source.rows[0]!.id;
      sourceIds.push(sourceId);
      await admin.query(
        "UPDATE public.sources SET status = 'ready', processed_at = now() WHERE id = $1",
        [sourceId],
      );
      const ingestion = await admin.query<{ id: string }>(
        "SELECT id FROM public.source_ingestions WHERE source_id = $1",
        [sourceId],
      );
      assert.equal(ingestion.rowCount, 1, "ready source must create one ingestion through the database trigger");
      const ingestionId = ingestion.rows[0]!.id;
      ingestionIds.push(ingestionId);
      return { sourceId, ingestionId };
    };

    const readIngestion = async (ingestionId: string) => {
      const result = await admin.query<{
        status: string;
        attempts: number;
        last_error_code: string | null;
      }>(
        "SELECT status, attempts, last_error_code FROM public.source_ingestions WHERE id = $1",
        [ingestionId],
      );
      return result.rows[0];
    };

    before(async () => {
      await admin.query("SELECT 1");
      const user = await admin.query<{ id: string }>(
        "INSERT INTO public.users (email, auth_user_id) VALUES ($1, $2) RETURNING id",
        [`mem024-e2e-${suffix}@example.invalid`, randomUUID()],
      );
      userId = user.rows[0]!.id;
      const workspace = await admin.query<{ id: string }>(
        "INSERT INTO public.workspaces (name, slug, owner_user_id) VALUES ($1, $2, $3) RETURNING id",
        ["MEM-024 integration", `mem024-e2e-${suffix}`, userId],
      );
      workspaceId = workspace.rows[0]!.id;
      await admin.query(
        "INSERT INTO public.workspace_members (workspace_id, user_id, role, status, joined_at) VALUES ($1, $2, 'owner', 'active', now())",
        [workspaceId, userId],
      );

      process.env.INGESTION_WORKER_LEASE_SECONDS = "15";
      process.env.INGESTION_WORKER_HEARTBEAT_MS = "1000";
      process.env.INGESTION_RECOVERY_POLL_MS = "300000";
      process.env.INGESTION_OUTBOX_LEASE_SECONDS = "10";
      process.env.INGESTION_MAX_ATTEMPTS = "5";
      dispatcher = new SourceIngestionDispatcherService();
      secondDispatcher = new SourceIngestionDispatcherService();
      worker = new SourceIngestionWorkerService(processor);
      worker.onModuleInit();
    });

    after(async () => {
      await worker?.onModuleDestroy();
      await dispatcher?.onModuleDestroy();
      await secondDispatcher?.onModuleDestroy();
      for (const ingestionId of ingestionIds) {
        const job = await queue.getJob(ingestionJobId(ingestionId));
        if (job) await job.remove().catch(() => undefined);
      }
      await queue.close();
      if (workspaceId) await admin.query("DELETE FROM public.workspaces WHERE id = $1", [workspaceId]);
      if (userId) await admin.query("DELETE FROM public.users WHERE id = $1", [userId]);
      await admin.end();
      delete process.env.INGESTION_WORKER_LEASE_SECONDS;
      delete process.env.INGESTION_WORKER_HEARTBEAT_MS;
      delete process.env.INGESTION_RECOVERY_POLL_MS;
      delete process.env.INGESTION_OUTBOX_LEASE_SECONDS;
      delete process.env.INGESTION_MAX_ATTEMPTS;
    });

    it("dispatches real outbox rows, processes BullMQ jobs, retries transient failures and persists permanent failures", async () => {
      const success = await createReadySource("MEM-024 successful ingestion");
      const permanent = await createReadySource("MEM-024 permanent failure");
      const transient = await createReadySource("MEM-024 transient retry");
      permanentIds.add(permanent.ingestionId);
      transientIds.add(transient.ingestionId);

      assert.equal(await dispatcher.dispatchBatch(), 3, "dispatcher must publish all three durable outbox events");

      const successJob = await queue.getJob(ingestionJobId(success.ingestionId));
      assert.ok(successJob, "published ingestion must exist in real Redis/BullMQ");
      assert.deepEqual(Object.keys(successJob.data).sort(), ["ingestionId", "sourceId", "workspaceId"]);
      assert.equal(successJob.data.ingestionId, success.ingestionId);
      assert.equal(successJob.data.sourceId, success.sourceId);
      assert.equal(successJob.data.workspaceId, workspaceId);

      await waitFor(
        () => readIngestion(success.ingestionId),
        (row) => row?.status === "succeeded",
        "successful ingestion persistence",
      );
      const permanentResult = await waitFor(
        () => readIngestion(permanent.ingestionId),
        (row) => row?.status === "failed",
        "permanent ingestion failure persistence",
      );
      assert.equal(permanentResult?.last_error_code, "unsupported_source");

      await waitFor(
        () => readIngestion(transient.ingestionId),
        (row) => row?.status === "succeeded",
        "transient retry success",
      );
      assert.equal(processorCalls.get(transient.ingestionId), 2, "BullMQ retry must execute the processor again");

      const outbox = await admin.query<{ published_at: Date | null }>(
        "SELECT published_at FROM public.source_ingestion_outbox WHERE ingestion_id = ANY($1::uuid[])",
        [[success.ingestionId, permanent.ingestionId, transient.ingestionId]],
      );
      assert.equal(outbox.rowCount, 3);
      assert.ok(outbox.rows.every((row) => row.published_at instanceof Date), "all dispatched outbox rows must be marked published");

      const concurrent = await createReadySource("MEM-024 concurrent dispatcher claim");
      const claims = await Promise.all([
        dispatcher.dispatchBatch(),
        secondDispatcher.dispatchBatch(),
      ]);
      assert.equal(claims[0]! + claims[1]!, 1, "SKIP LOCKED must let only one dispatcher publish the same outbox row");
      await waitFor(
        () => readIngestion(concurrent.ingestionId),
        (row) => row?.status === "succeeded",
        "concurrently dispatched ingestion",
      );

      const expired = await createReadySource("MEM-024 expired worker lease");
      await admin.query(
        `UPDATE public.source_ingestions
         SET status = 'processing', attempts = 1, lease_token = $2,
             lease_until = now() - interval '1 second', heartbeat_at = now()
         WHERE id = $1`,
        [expired.ingestionId, randomUUID()],
      );
      await admin.query(
        "UPDATE public.source_ingestion_outbox SET published_at = now() WHERE ingestion_id = $1",
        [expired.ingestionId],
      );
      assert.equal(await worker.recoverExpiredLeases(), 1, "worker must recover the expired database lease");
      const recovered = await readIngestion(expired.ingestionId);
      assert.equal(recovered?.status, "queued");
      assert.equal(recovered?.last_error_code, "worker_lease_expired");
      const recoveredOutbox = await admin.query<{ published_at: Date | null; lease_token: string | null }>(
        "SELECT published_at, lease_token FROM public.source_ingestion_outbox WHERE ingestion_id = $1",
        [expired.ingestionId],
      );
      assert.equal(recoveredOutbox.rows[0]?.published_at, null);
      assert.equal(recoveredOutbox.rows[0]?.lease_token, null);
      assert.equal(await dispatcher.dispatchBatch(), 1, "recovered outbox event must be dispatchable again");
      await waitFor(
        () => readIngestion(expired.ingestionId),
        (row) => row?.status === "succeeded",
        "recovered ingestion processing",
      );
    });
  },
);
