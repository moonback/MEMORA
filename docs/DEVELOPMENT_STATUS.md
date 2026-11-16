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
- Current implementation branch: `feature/MEM-016-memories-and-evidence`.

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

## In progress: MEM-016 memories and evidence
- Workspace-scoped memory create/list/detail/update/archive endpoints.
- Confidence (0–100), event time and validity interval metadata.
- Evidence links to source chunks with supports/contradicts/context classifications, optional quote and confidence.
- Atomic memory creation with evidence validation and same-workspace enforcement.
- Explicit supersession flow preserving the previous memory and linking the replacement.
- API request contract tests and query-path database indexes.
- Validation has not yet been run for this branch. PostgreSQL integration tests remain dependent on DATABASE_URL and DATABASE_APP_URL.

## Validation status
MEM-015 local validation was reported by the user: `pnpm typecheck`, 37 tests and `pnpm build` passed. PostgreSQL integration suites were skipped because database environment variables were not configured. GitHub Actions startup failures have prevented reliable CI evidence in earlier milestones. MEM-016 has been authored through the GitHub integration and must be validated locally before merge.

## Not yet implemented
Binary upload and EU object storage, ingestion workers (parsing/OCR/transcription), AI extraction and recall, entity resolution and knowledge graph API, audit event integration, external connectors, mobile and desktop clients, retention/deletion workflows, account deletion/email change and production hardening.
