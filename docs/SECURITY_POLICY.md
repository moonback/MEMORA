# Security Policy

- Never commit credentials, tokens or private user data.
- Enforce authentication and authorization server-side.
- Require active workspace membership and role checks for every workspace-scoped API route.
- Enforce PostgreSQL RLS on workspace-owned tables using transaction-local identity and workspace context.
- Run the API with a dedicated database role that is not a superuser, table owner or granted BYPASSRLS; keep migration credentials separate.
- Store invitation token hashes only; require verified email ownership and single-use, expiring invitation tokens.
- Apply workspace isolation to every private record.
- Use PostgreSQL RLS as defense in depth.
- Scope database context per transaction; never trust an unverified workspace ID from a client.
- Do not log secrets or full private content.
- Preserve source provenance and support user-controlled export and deletion.
- Production deployment must use TLS, managed secrets, backups and EU data residency controls.
