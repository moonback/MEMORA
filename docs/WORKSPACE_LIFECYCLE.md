# Personal Workspace Lifecycle

## Provisioning
Every new authenticated identity is linked to a UUID-based MEMORA user profile. The signup hook calls the same `ensurePersonalWorkspace` service used by the API. It creates the personal workspace if missing and upserts an active `owner` membership. The operation runs in the same PostgreSQL transaction as profile provisioning.

A partial unique index on `workspaces.owner_user_id WHERE type = 'personal'` guarantees at most one personal workspace per user. The provisioner uses a matching `ON CONFLICT` target, so concurrent/repeated calls remain idempotent.

## Workspace metadata
- `name`: required, 1–120 characters.
- `description`: optional, up to 500 characters.
- `metadata`: JSON object for a limited appearance configuration (`accentColor`, `icon`).
- `archived_at`: nullable timestamp; non-null means archived.

## API routes
- `GET /api/workspaces/personal`: retrieve the caller's personal workspace.
- `POST /api/workspaces/personal/ensure`: idempotently create/repair the personal workspace and owner membership.
- `PATCH /api/workspaces/personal`: update name, description and appearance metadata.
- `POST /api/workspaces/personal/archive`: archive the personal workspace.
- `POST /api/workspaces/personal/restore`: restore the personal workspace.

All routes require a valid Better Auth session. The server derives the domain user ID from the authenticated identity; callers cannot supply an owner ID or workspace ID. These endpoints operate only on the caller's personal workspace.

## Archive semantics
Archive is reversible and non-destructive. It sets `archived_at` and retains the workspace and all related data. Restoring clears the timestamp. A workspace must be restored before its metadata can be edited. Hard deletion is intentionally not provided.

## Security boundary
MEM-012 does not implement shared workspace membership administration or general workspace RBAC. Those remain MEM-013. PostgreSQL RLS and per-request tenant context remain MEM-014. Future workspace data endpoints must reject archived workspaces and enforce membership/RLS independently.
