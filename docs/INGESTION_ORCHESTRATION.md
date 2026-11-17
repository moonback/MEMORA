# Durable source ingestion orchestration (MEM-024)

## Architecture

The source-ready transition and ingestion outbox row are committed atomically by migration 0011. The dispatcher reads the outbox with the system database connection, claims rows using `FOR UPDATE SKIP LOCKED` and a lease token, and publishes only `ingestionId`, `sourceId` and `workspaceId` to BullMQ.

The dispatcher marks `published_at` only after `Queue.add` resolves. If Redis is unavailable, it clears its lease, stores the fixed error code `queue_publish_failed` and schedules a bounded retry. If the process crashes after Redis accepted the job but before PostgreSQL records publication, the expired outbox lease is reclaimed and the same deterministic job ID is published again. The worker's database lease and terminal-state checks make duplicate delivery harmless.

The worker claims an ingestion only when the identifiers match the same workspace and the source is still `ready`. It uses a lease token for heartbeat and every state transition. Processing runs outside database transactions. Expired worker leases reopen the associated outbox event so another dispatcher cycle can recover it. Error details and private source content are never written to logs or queue payloads.

## Processor boundary

`SourceIngestionProcessor` is the extension point for extraction work. MEM-025 registers `SourceTextExtractionProcessor` (TXT/Markdown, see [TEXT_EXTRACTION.md](TEXT_EXTRACTION.md)); `UnconfiguredSourceIngestionProcessor` remains available and raises the permanent error `processor_unavailable`, which the worker records as `failed`. It never marks a source `succeeded` merely because a job was delivered. Register a real processor only when it performs a real, tenant-revalidated operation. Parsing, OCR, antivirus, embeddings and memory generation remain out of scope.

## Configuration

- `DATABASE_SYSTEM_URL`: privileged service connection for cross-workspace outbox/worker operations. Falls back to `DATABASE_URL` for local development only. Never use `DATABASE_APP_URL`.
- `REDIS_URL`: Redis connection string.
- `INGESTION_OUTBOX_POLL_MS`: dispatcher polling interval (default 2000; 250–60000).
- `INGESTION_OUTBOX_LEASE_SECONDS`: outbox lease (default 60; 10–900).
- `INGESTION_WORKER_LEASE_SECONDS`: worker lease (default 120; 15–1800).
- `INGESTION_WORKER_HEARTBEAT_MS`: heartbeat interval (default 30000).
- `INGESTION_RECOVERY_POLL_MS`: expired-lease recovery interval (default 15000).
- `INGESTION_WORKER_CONCURRENCY`: worker concurrency (default 5; 1–20).
- `INGESTION_MAX_ATTEMPTS`: BullMQ attempt budget (default 5; 1–10).

Run PostgreSQL and Redis with `docker compose up -d`, then start the API. The dispatcher and worker are hosted by the NestJS application and shut down their timers, BullMQ connections and PostgreSQL pools on module teardown.

## Validation

Run `pnpm typecheck`, `pnpm test` and `pnpm build`. Database integration tests still require the configured PostgreSQL URLs. Redis-dependent integration tests must run against the local Redis service before production readiness is claimed.
