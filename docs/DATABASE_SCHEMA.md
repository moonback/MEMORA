# Database Schema

## Principles

- PostgreSQL is the source of truth for durable application data.
- Every private domain record is scoped to a workspace.
- Composite foreign keys enforce that a memory, source chunk, entity and evidence reference belong to the same workspace.
- Deletion behavior is explicit: workspace-owned data cascades with its workspace; user ownership is restricted where auditability or ownership must be preserved.
- Consent decisions are versioned and timestamped.
- PostgreSQL Row-Level Security is deliberately a separate security milestone (MEM-014); composite constraints are not a substitute for RLS.

## Tables

| Domain | Tables | Purpose |
|---|---|---|
| Identity | users, user, session, account, verification | UUID-based MEMORA profile plus Better Auth credentials, sessions and verification tokens |
| Workspace | workspaces, workspace_members, workspace_invitations | Personal/shared spaces, owner metadata, reversible archive state, membership and invitations |
| Privacy | consents | Purpose-specific, versioned consent history |
| Capture | sources, source_chunks | Imported origin records and normalized text chunks |
| Memory | memories, memory_evidence | Typed, temporal memories with provenance |
| Knowledge graph | entities, memory_entities, entity_relations | Canonical entities and workspace-local relationships |
| Governance | audit_logs | Activity and security events |

## Important constraints

- A source chunk references its source through the pair (source_id, workspace_id).
- Evidence references both memory and source chunk through workspace-qualified composite foreign keys.
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

Add future migrations as the next zero-padded SQL filename (for example, `0004_next_domain_change.sql`). Do not edit a migration after it has been applied to a shared or production database; add a corrective migration instead.

The Drizzle schema in `packages/database/src/schema/index.ts` mirrors the application-domain model for typed queries and Drizzle Studio. Better Auth's identity/session tables are maintained in reviewed SQL and accessed through its PostgreSQL adapter. Migrations are intentionally reviewed SQL rather than untracked auto-generated snapshots.

## Local setup

1. Start PostgreSQL with the repository Docker Compose file.
2. Set `DATABASE_URL` in the root `.env`.
3. Run `pnpm db:migrate`.
4. Verify tables and constraints in PostgreSQL before connecting application services.

## Not yet enabled

RLS policies, per-request workspace context, automated cross-tenant negative tests, retention jobs, and vector embeddings/indexes are subsequent milestones. Better Auth persists credentials and sessions in `user`, `session`, `account`, and `verification`; `users.auth_user_id` links that identity to the UUID-based domain user. The `vector` extension is enabled by the initial migration, but no embedding column or vector index is created yet.
