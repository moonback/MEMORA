# Durable source ingestion orchestration (MEM-024)

## Current implementation

Migration `0011_source_ingestion_outbox.sql` introduces two workspace-aware records:

- `source_ingestions`: one stable ingestion record per source/version, with queued/processing/succeeded/failed states, attempt budget, availability time, lease token/deadline, heartbeat and normalized error code.
- `source_ingestion_outbox`: transactional event record with a unique ingestion/event key. Its payload is constrained to an empty JSON object; source content, signed URLs, credentials and private metadata are not stored in the event.

Database triggers enqueue the event in the same PostgreSQL transaction that makes a source ready. Manual capture uses the existing pending-to-ready transition. A verified object automatically transitions its source from pending to ready, which then creates the ingestion and outbox rows. A rolled-back source transition therefore also rolls back its ingestion event.

The application role can read only ingestion state through workspace RLS. The outbox is reserved for the trusted system role and is not readable by the application role. Use `DATABASE_SYSTEM_URL` (or the existing `DATABASE_URL` migration/admin connection) for future cross-workspace dispatch and worker processes; never use `DATABASE_APP_URL` for a global worker.

The source list and detail API responses expose the latest ingestion state, attempts, maximum attempts, update timestamp and allow-listed error code.

## State contract

| State | Meaning |
|---|---|
| queued | Source is ready and the durable ingestion request exists |
| processing | A worker has acquired a time-bounded lease |
| succeeded | The registered ingestion processor completed |
| failed | The retry budget was exhausted or the processor classified the failure as permanent |

The database schema reserves lease and retry fields for the dispatcher/worker implementation. A queued record is not evidence that parsing, OCR, extraction, embeddings or indexing have run.

## Operational boundary

This milestone establishes atomic enqueueing, idempotency, tenant-visible state and a restricted outbox. The Redis/BullMQ dispatcher, lease-recovery worker, heartbeat loop, bounded retry scheduler and dead-letter handling remain the next implementation slice before this can be called a production-ready ingestion executor. Do not mark a source processed merely because its outbox event exists.

## Validation

After pulling the feature branch and applying migrations, run:

```powershell
pnpm db:migrate
pnpm typecheck
pnpm test
pnpm build
```

The database integration tests require both `DATABASE_URL` and `DATABASE_APP_URL` in the same PowerShell process. The new migration must be applied before the MEM-024 tests can pass.
