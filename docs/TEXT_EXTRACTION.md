# Text extraction and normalization (MEM-025)

MEM-025 replaces `UnconfiguredSourceIngestionProcessor` with `SourceTextExtractionProcessor`
(`apps/api/src/sources/source-text-extraction.processor.ts`). The MEM-024 worker contract (claim,
lease, heartbeat, `succeeded` only after the processor returns and the lease is still held) is unchanged.

## Pipeline

1. **Re-anchor the job.** In a transaction scoped by `set_config('app.workspace_id', $1, true)`, require a
   `source_ingestions` row matching `(ingestionId, sourceId, workspaceId)` with `status='processing'`
   and a `ready` source. A forged or stale job sees no row under RLS and fails `invalid_source_state`.
2. **Select the path by source.**
   - `manual` sources, and sources without an object whose chunks were provided through the chunk API:
     the current chunks are kept untouched (no re-extraction, no duplicate). No current chunk → permanent failure.
   - `document` and `note` with a source object: text extraction.
   - Any other type (`email`, `audio`, `image`, `web_clip`): `unsupported_source`.
3. **Require a verified object** (`status='verified'`, checksum and size present), check the format and the
   10 MiB text limit, then download **outside any transaction** through `S3ObjectStorageService.readObject`,
   which enforces exact size and SHA-256.
4. **Decode, normalize and chunk** (pure functions in `source-text.ts`).
5. **Persist** in a second scoped transaction: re-check the claim, lock the source `FOR UPDATE`, verify the
   object checksum has not changed since download, then apply versioned replacement.

## Supported formats

Only plain text and Markdown. Anything else, including PDF, is refused (`unsupported_format`).

| MIME type (parameters ignored except `charset`) | Accepted extensions of `original_name` |
| --- | --- |
| `text/plain` | none, `.txt`, `.md`, `.markdown` (browsers often label Markdown as plain text) |
| `text/markdown`, `text/x-markdown` | none, `.md`, `.markdown` |

A `charset` other than UTF-8 / US-ASCII is refused. A contradictory extension (e.g. `report.pdf` declared as
`text/plain`, or `notes.txt` declared as Markdown) is refused. The format check does not decide integrity:
integrity comes only from the verified size and SHA-256.

## Normalization rules (deterministic, idempotent)

- A NUL byte means binary content: refused (`unsupported_format`).
- Strict UTF-8 decoding: any invalid sequence is refused (`invalid_text_encoding`); no replacement characters.
- A leading UTF-8 BOM is removed.
- Unicode NFC (canonical composition). NFKC is not applied because it changes meaning (ligatures, widths).
- CRLF and CR become LF.
- C0/C1 control characters are removed, except LF and TAB.
- Whitespace-only lines become empty; runs of blank lines collapse to one; leading/trailing blank lines are trimmed.
- Indentation and trailing spaces inside lines are kept (Markdown code blocks and hard line breaks).
- Empty result: `empty_content` (permanent). An ingestion never succeeds with zero chunks.

## Chunking rules

- Maximum 2,000 UTF-16 code units per chunk (`MAX_CHUNK_CHARS`); no overlap (it would blur chunk identity and evidence).
- Paragraphs (separated by a blank line) are packed greedily, joined by a blank line, up to the maximum.
- A paragraph longer than the maximum becomes its own chunks, split at the last line break, else the last
  space/tab, inside the window. Words are never cut, except a single token longer than the maximum, which is
  cut at the maximum without splitting a surrogate pair.
- No empty chunk. Ordinals are 0..n-1 in document order. Same input → same contents and ordinals.
- `token_count` stays `NULL`: no reliable tokenizer is configured.

## Versioned persistence and evidence preservation

Migration `0012_source_chunk_versions.sql` (additive) adds `source_chunks.is_current boolean NOT NULL DEFAULT true`
and replaces `UNIQUE (source_id, ordinal)` with the partial unique index
`source_chunks_source_ordinal_current_unique ON (source_id, ordinal) WHERE is_current`.

`replaceCurrentChunks` (`source-chunk-versioning.ts`) is shared by the processor and `PUT …/chunks`:

- A current chunk identical to an incoming one (same ordinal and all stored fields equal, jsonb compared by value) keeps its ID.
- Every other current chunk is **retired** (`is_current=false`), never deleted. Evidence tables reference chunks
  `ON DELETE CASCADE`; a check-for-evidence-then-delete sequence would race with a concurrent evidence insert under
  READ COMMITTED and silently destroy it. Keeping all retired chunks is the safe choice; storage growth is the trade-off.
- New or changed content gets a new ID; an old ID is never reused for different content.
- Retirement happens before insertion so the partial unique index never collides; duplicate incoming ordinals are refused.
- The source row is locked `FOR UPDATE`, so concurrent extractions and `PUT` calls on one source serialize.
  Everything runs in one transaction; any failure rolls back the whole replacement.

Reads:

- `GET …/sources/:id/chunks` and `chunk_count` return current chunks only.
- Memory and relation evidence reads, and evidence ID validation, do **not** filter `is_current`: historical evidence
  keeps resolving to the exact chunk (and content) it was created against.

`PUT …/chunks` still sets the source `ready`, which triggers the single MEM-024 ingestion of that source:

- source without object: the provided chunks are kept as is;
- source whose object is not yet `verified` (upload in progress): the processor fails `invalid_source_state`, and
  because the source is already `ready` (and `source_version = 1` already exists), the later object verification
  does not enqueue a new ingestion. **That file is then never extracted** (see known limits).

## Errors

Permanent (`failed`, no retry): `unsupported_source`, `unsupported_format`, `invalid_text_encoding`, `empty_content`,
`invalid_source_state`, `object_integrity_failed` (size/checksum mismatch on a verified object), `object_missing`
(`NoSuchKey`), `object_too_large`.

Transient (requeued by the worker until `max_attempts`): network or interrupted stream errors, an object checksum
changed during extraction, database errors.

## PostgreSQL access strategy and RLS

Audit (local environment, 2026-11-17): `DATABASE_SYSTEM_URL` is not set, so the worker falls back to `DATABASE_URL`,
whose role `memora` is **superuser with BYPASSRLS** and owns every table. RLS is not enforced on that connection.

The processor therefore does **not** use the worker's system pool. It uses `authPool` (`DATABASE_APP_URL`, role
`memora_app`: NOSUPERUSER, NOBYPASSRLS, not owner) and sets only transaction-local `app.workspace_id`. Existing
workspace policies (`workspace_id = memora_current_workspace_id()`) then confine every read and write to the job's
workspace; explicit `workspace_id` predicates in every parameterized query add a second barrier. No new role, policy,
grant or `BYPASSRLS` is introduced. The integration test asserts the processor pool is neither superuser nor BYPASSRLS
and that a job carrying another workspace's ID reads and writes nothing.

`memora_app` can already set any `app.workspace_id`; this processor grants it no new capability. The authority to
pick a workspace comes from the claimed `source_ingestions` row, re-checked inside each transaction.

### Remaining administrative work (not applied)

The MEM-024 worker's own queries (claim with a join on `sources`, heartbeat, recovery, outbox) still require a role that
sees all workspaces. Moving them to a dedicated least-privilege role needs an administrator and an additive, role-scoped
policy migration, for example:

```sql
-- Run as an administrator. Not applied by MEM-025.
CREATE ROLE memora_ingestion LOGIN PASSWORD '<secret>' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT CONNECT ON DATABASE memora TO memora_ingestion;
GRANT USAGE ON SCHEMA public TO memora_ingestion;
GRANT SELECT, UPDATE ON public.source_ingestions, public.source_ingestion_outbox TO memora_ingestion;
GRANT SELECT (id, workspace_id, status) ON public.sources TO memora_ingestion;
-- plus policies limited TO memora_ingestion on source_ingestions and sources (SELECT only),
-- in a new migration with RLS tests; then set DATABASE_SYSTEM_URL to this role.
```

Until then, `DATABASE_SYSTEM_URL` must point to a trusted operations role and never to `memora_app`.

## Migration procedure

0012 is not applied automatically to shared databases. It was validated on the isolated database `memora_mem025_test`.

**0012 must be applied before deploying or running this code.** Without it, `GET …/sources/:id`, `GET`/`PUT …/chunks`
and the processor reference a missing `is_current` column: endpoints return 500 and ingestions fail transiently until
`max_attempts`, then `failed`.

1. Check that no other session holds long locks on `source_chunks` (the `ALTER TABLE` takes an `ACCESS EXCLUSIVE` lock
   briefly; `CREATE UNIQUE INDEX` scans the table).
2. Back up the database.
3. Run `pnpm db:migrate` with `DATABASE_URL` pointing to the owner role.
4. Verify: `SELECT indexdef FROM pg_indexes WHERE indexname = 'source_chunks_source_ordinal_current_unique';`

Existing rows become `is_current = true`; no row is deleted or rewritten.

## Known limits

- PDF, DOCX, email (MIME), audio and image are not extracted.
- A text object is limited to 10 MiB (memory bound: about 2 bytes per decoded character, plus the chunks).
- Retired chunks are never garbage-collected.
- `PUT …/chunks` on a file source whose upload is not yet verified consumes its only ingestion; the file is never extracted.
- Sources that already failed with `processor_unavailable` before MEM-025 are not reprocessed (one ingestion per source);
  a reprocessing mechanism is a follow-up.
- MEM-024 creates one ingestion per source (`source_version = 1`), so re-extraction of a changed object is not triggered
  automatically. Verified objects are immutable (migration 0010), so content changes today come only through `PUT …/chunks`.

## Tests

- `source-text.spec.ts`: format detection, normalization and chunking (pure).
- `source-text-extraction.integration.spec.ts`: real PostgreSQL, processor on the restricted `memora_app` pool, real
  `S3ObjectStorageService` with the S3 client stubbed at the network boundary. Requires
  `MEMORA_EXTRACTION_TEST_DATABASE_URL` (fixtures, owner role) and `MEMORA_EXTRACTION_TEST_APP_DATABASE_URL` (`memora_app`);
  skipped otherwise.
