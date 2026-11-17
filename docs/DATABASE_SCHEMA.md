# Database Schema

## Principles

- PostgreSQL is the source of truth for durable application data.
- Every private domain record is scoped to a workspace.
- Composite foreign keys enforce that a memory, source chunk, entity and evidence reference belong to the same workspace.
- Deletion behavior is explicit: workspace-owned data cascades with its workspace; user ownership is restricted where auditability or ownership must be preserved.
- Consent decisions are versioned and timestamped.
- PostgreSQL Row-Level Security is enabled and forced on private domain tables; composite constraints provide an additional integrity boundary.

## Tables

| Domain | Tables | Purpose |
|---|---|---|
| Identity | users, user, session, account, verification | UUID-based MEMORA profile plus Better Auth credentials, sessions and verification tokens |
| Workspace | workspaces, workspace_members, workspace_invitations | Personal/shared spaces, owner metadata, reversible archive state, membership and invitations |
| Privacy | consents | Purpose-specific, versioned consent history |
| Capture | sources, source_chunks, source_objects | Imported origin records, normalized text chunks and private object-storage metadata |
| Memory | memories, memory_evidence | Typed, temporal memories with provenance |
| Knowledge graph | entities, memory_entities, entity_relations, entity_relation_evidence | Canonical entities, memory mentions, typed relations and source provenance |
| Governance | audit_logs | Activity and security events |

## Important constraints

- A source chunk references its source through the pair (source_id, workspace_id).
- Evidence references both memory and source chunk through workspace-qualified composite foreign keys.
- MEM-025: `source_chunks.is_current` marks the latest chunk set; ordinals are unique among current chunks only (`source_chunks_source_ordinal_current_unique`). Replaced chunks are retired, not deleted, so evidence keeps its historical target (migration 0012, see `TEXT_EXTRACTION.md`).
- Memory-to-entity links and entity relations are workspace-qualified.
- Memory confidence values are constrained to 0–100.
- Temporal validity ranges cannot end before they begin.
- Entity canonical names are unique case-insensitively per workspace and entity type.
- External source identifiers are unique per workspace/provider when supplied.
- Invitation tokens are stored as hashes, not raw invitation tokens.
- A partial unique index guarantees at most one personal workspace per owner; shared workspaces are not restricted.
- Personal workspace metadata includes a bounded description, JSON metadata and a reversible `archived_at` timestamp.

## Migrations

The reviewed SQL files in `packages/database/migrations` are the migration source of truth. They are applied in lexical order by `pnpm db:migrate` (or `pnpm --filter @memora/database db:migrate`). The runner records applied filenames in `public._memora_migrations`, applies each file in a transaction, and uses a PostgreSQL advisory lock to prevent concurrent migration runners.

Add future migrations as the next zero-padded SQL filename. Do not edit a migration after it has been applied to a shared or production database; add a corrective migration instead.

The Drizzle schema in `packages/database/src/schema/index.ts` mirrors the application-domain model for typed queries and Drizzle Studio. Better Auth's identity/session tables are maintained in reviewed SQL and accessed through its PostgreSQL adapter. Migrations are intentionally reviewed SQL rather than untracked auto-generated snapshots.

## Local setup

1. Start PostgreSQL with the repository Docker Compose file.
2. Set `DATABASE_URL` in the root `.env`.
3. Run `pnpm db:migrate`.
4. Verify tables and constraints in PostgreSQL before connecting application services.

## Row-Level Security

MEM-014 adds and forces PostgreSQL RLS on users, workspaces, memberships, invitations, consents, sources, chunks, memories, evidence, entities, relations and audit logs. API requests establish transaction-local user and workspace context only after resolving the authenticated identity and verifying active membership. Automated negative tests use a restricted non-owner application role and assert cross-workspace reads, source writes and membership injection are denied. See `POSTGRESQL_RLS_SETUP.md` for role provisioning and environment configuration.

RLS requires a dedicated runtime database role (`DATABASE_APP_URL`) without superuser, table-owner or `BYPASSRLS` privileges. `DATABASE_URL` remains reserved for migrations. Do not use a superuser runtime connection in production.

Retention jobs and vector embeddings/indexes remain subsequent milestones. Better Auth persists credentials and sessions in `user`, `session`, `account`, and `verification`; `users.auth_user_id` links that identity to the UUID-based domain user. The `vector` extension is enabled by the initial migration, but no embedding column or vector index is created yet.

## Source capture API

MEM-015 exposes authenticated workspace-scoped source metadata and chunk endpoints. Source creation stores origin type, title, original filename, MIME type, SHA-256 checksum, capture timestamp and bounded structured metadata. Sources begin in `pending`; replacing the normalized chunk set is transactional and marks the source `ready`. Chunks preserve ordinal, token count, page number, media time offsets and metadata. Archiving is soft and retains provenance. Binary upload and object storage are intentionally not part of MEM-015; see `SOURCES_API.md`. MEM-019 adds the workspace-scoped `source_objects` metadata table, with provider/bucket/object coordinates, upload state, size, checksum and verification timestamps. Object bytes remain outside PostgreSQL in a private EU-resident S3-compatible store; see `OBJECT_STORAGE.md`.

## Memory lifecycle and evidence

MEM-016 exposes workspace-scoped memory CRUD and lifecycle endpoints. Memories preserve their semantic type, content, summary, confidence, event time, validity interval and structured attributes. Evidence rows link memories to source chunks through composite workspace-qualified foreign keys; evidence records retain classification, optional excerpt, confidence and creation time. Supersession creates a new memory linked to the prior record and marks the prior record `superseded` rather than overwriting history. See `MEMORIES_API.md`.

## Audit trail (MEM-018)

The existing `audit_logs` table is now populated by PostgreSQL triggers for INSERT/UPDATE operations on sources, memories, entities and entity relations. Audit writes occur in the same transaction as the business mutation. Metadata is limited to structural information and safe changed-column names; private values are not copied. RLS scopes audit reads/inserts to the active workspace and validates the actor. Direct UPDATE/DELETE is rejected by a database trigger, while referential cascades remain available for workspace/account erasure. See `AUDIT_LOG.md`.


## Durable source ingestion (MEM-024)

Migration `0011_source_ingestion_outbox.sql` adds workspace-scoped `source_ingestions` state and a restricted `source_ingestion_outbox`. Database triggers create one stable ingestion event in the same transaction that transitions a source to `ready`; verified object metadata automatically transitions its source to ready. The outbox payload is constrained to `{}` so no source content, signed URL, credential or private metadata can enter the queue. The application role can read ingestion state only under workspace RLS; cross-tenant outbox dispatch is reserved for a trusted system role. See `INGESTION_ORCHESTRATION.md`. The Redis/BullMQ dispatcher and execution worker are not yet part of this migration slice.
