# Private source object storage (MEM-019)

## Architecture boundary

PostgreSQL stores object metadata and lifecycle state; binary bytes belong in a private, EU-resident S3-compatible object store. The application depends on a provider-neutral storage port, not a vendor SDK. A concrete adapter and upload endpoints are deliberately deferred until credentials, region, retention and signing policy are configured.

## Database contract

The `source_objects` table associates at most one primary binary object with a source. It records the provider identifier, private bucket name, server-generated object key, content type, byte size, SHA-256 checksum, optional provider ETag/version and upload/verification timestamps.

The object row is workspace-scoped and references `sources(id, workspace_id)` through a composite foreign key. RLS is enabled and forced. Deleting a source cascades its object metadata; the storage adapter must separately perform idempotent byte deletion through an outbox/worker before production rollout.

## Lifecycle

- `pending`: metadata allocated; upload has not been confirmed.
- `uploaded`: provider confirms bytes were received.
- `verified`: server-side HEAD/checksum/size validation succeeded.
- `failed`: upload or verification failed and may be retried according to policy.
- `deleted`: object deletion was confirmed.

The database rejects unknown states, sizes above 100 MiB, malformed SHA-256 checksums and a `verified` state without upload/verification timestamps, size and checksum.

## Security requirements for the next slice

- Generate opaque object keys on the server; never accept bucket/key from clients.
- Keep buckets private and disable public ACLs.
- Authorize every operation against active workspace membership and role.
- Use short-lived, content-type/size-bound presigned requests only after the API authorizes the source.
- Verify actual bytes and checksum server-side; do not trust browser MIME or ETag as a SHA-256 checksum.
- Never expose provider credentials or raw bucket paths to the client.
- Apply EU region, encryption-at-rest, TLS, lifecycle/retention and deletion guarantees at provider configuration.
- Use an outbox and retryable worker for object deletion; database cascades alone do not delete remote bytes.

## Current implementation boundary

MEM-019 currently adds the database metadata model, constraints, RLS and integration coverage. It does not yet upload bytes, issue signed URLs, scan files, parse documents or guarantee remote deletion. Those capabilities must not be represented as available until the provider adapter and API workflow are implemented and tested.
