# Security Policy

- Never commit credentials, tokens or private user data.
- Enforce authentication and authorization server-side.
- Apply workspace isolation to every private record.
- Use PostgreSQL RLS as defense in depth.
- Scope database context per transaction; never trust an unverified workspace ID from a client.
- Do not log secrets or full private content.
- Preserve source provenance and support user-controlled export and deletion.
- Production deployment must use TLS, managed secrets, backups and EU data residency controls.
