# PostgreSQL application role and RLS

MEMORA migrations run with `DATABASE_URL` using a migration/owner role. The API and application tests use `DATABASE_APP_URL`, which must connect as a dedicated role that is neither a superuser nor a table owner and does not have `BYPASSRLS`.

## Provision the application role

Run as a PostgreSQL administrator after creating the database and before starting the API:

```sql
CREATE ROLE memora_app
  LOGIN
  PASSWORD 'replace-with-a-long-random-secret'
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOINHERIT
  NOBYPASSRLS;

GRANT CONNECT ON DATABASE memora TO memora_app;
GRANT USAGE ON SCHEMA public TO memora_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO memora_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO memora_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO memora_app;

-- Run as the role that owns and applies future migrations.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO memora_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO memora_app;
```

Do not grant `memora_app` membership in the migration/owner role. Keep its password separate from `DATABASE_URL`.

## Environment

- `DATABASE_URL`: migration connection; owner/admin credentials.
- `DATABASE_APP_URL`: runtime API connection; restricted `memora_app` credentials.

The API selects `DATABASE_APP_URL` for Better Auth and domain queries. Production startup fails if this variable is absent. A local development fallback to `DATABASE_URL` is convenient but bypasses RLS when that role is a superuser or table owner; it is not an acceptable production or security-test configuration.

## Tenant transaction context

Every API domain operation must use a database transaction and set transaction-local context with parameterized `set_config(..., true)` calls:

- `app.auth_user_id`: Better Auth identity UUID.
- `app.user_id`: MEMORA domain user UUID resolved from the authenticated identity.
- `app.user_email`: verified profile e-mail for pending invitation acceptance.
- `app.workspace_id`: workspace UUID, set only after active membership is verified (or after a matching invitation token and recipient e-mail are verified).

The helper in `apps/api/src/database/tenant-context.ts` performs the user/membership lookup and transaction lifecycle. Never set tenant context from request body fields or trust a client-supplied user ID.

## RLS coverage

The migration enables and forces RLS on users, workspaces, workspace_members, workspace_invitations, consents, sources, source_chunks, memories, memory_evidence, entities, memory_entities, entity_relations and audit_logs. Better Auth's own identity/session tables remain outside workspace RLS and are accessed through the restricted application role's explicit grants.

The application role must not be a superuser, table owner, or have `BYPASSRLS`; otherwise PostgreSQL may bypass policies. RLS is defense in depth and does not replace API authorization or parameterized SQL.
