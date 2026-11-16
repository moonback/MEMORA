# Development Status

Updated: 2026-11-16

## Repository
- Private GitHub repository: moonback/MEMORA.
- Foundation merged via PR #9.
- Health/readiness endpoints merged via PR #20.
- Core database schema and migrations merged via PR #21.
- Authentication and sessions merged via PR #22.
- Profile and account settings merged via PR #23.
- Personal workspace lifecycle merged via PR #24.
- Workspace membership and RBAC merged via PR #25.
- PostgreSQL RLS and tenant isolation merged via PR #29 (squash commit `e516f0be439b00ffbd12e29a220a1579aa0cbf26`).
- MEM-015 sources and chunks merged via PR #30 (squash commit `a15d951641f2447c1361843f70dd809d2eae90d0`).
- MEM-016 memories and evidence merged via PR #31 (squash commit `f84d688ec176cde2533cb0aaca38a2a92696addb`).
- MEM-017 entities and knowledge relations merged via PR #32 (squash commit `16e711a419efb73c83923c583aae94af3ac8deab`).
- Current implementation branch: `feature/MEM-018-audit-log-security-tests`.

## Merged into main
- pnpm workspace, strict TypeScript configuration, Next.js dashboard and NestJS API.
- PostgreSQL/pgvector and Redis local infrastructure.
- Core Drizzle schema and reviewed SQL migrations for users, workspaces, consent, sources, memories, evidence, entities, audit logs and Better Auth identities/sessions.
- Transactional migration runner with advisory locking and applied-migration tracking.
- Better Auth email/password authentication, email verification, password reset, database-backed sessions and session revocation.
- API global session guard, public health routes and protected account endpoints.
- Personal and shared workspace lifecycle, membership, invitations and owner/admin/member/viewer RBAC.
- PostgreSQL forced RLS policies, transaction-local tenant context and cross-tenant negative tests.
- Workspace-scoped source metadata API, source chunk replacement and provenance.
- Workspace-scoped memory lifecycle, evidence provenance and supersession.
- Workspace-scoped entities, memory links, typed temporal relations and relation evidence.

## User-reported validation
- MEM-016: PostgreSQL tests 18/18, API tests 43/43, typecheck and builds passed locally.
- MEM-017: PostgreSQL tests 21/21, API tests 48/48, typecheck and builds passed locally after a TypeScript fix. GitHub Actions reported `startup_failure`; automated CI evidence remains unavailable.

## In progress: MEM-018 audit log and security integration tests
- Migration adds automatic transactional audit events for INSERT/UPDATE on sources, memories, entities and entity relations.
- Audit metadata stores only table/operation and safe changed-column names, never private field values.
- Forced workspace RLS and actor checks apply to audit inserts and reads.
- Direct audit UPDATE/DELETE is rejected by PostgreSQL; referential cascades remain available for workspace/account erasure.
- Integration tests cover workspace isolation, actor spoofing, metadata minimization and append-only behavior.
- Local validation is pending.

## Not yet implemented
Binary upload and EU object storage, ingestion workers (parsing/OCR/transcription), AI extraction and recall, entity resolution and graph traversal/ranking, external connectors, mobile and desktop clients, retention/export workflows, account deletion/email change UX and production hardening.
