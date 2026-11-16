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
- PostgreSQL RLS and tenant isolation merged via PR #29 (squash commit `e516f0be439b00ffbd12e29a220a1579aa0cbf26`); duplicate PR #28 closed.
- Current implementation branch: `feature/MEM-015-sources-and-chunks`.

## Merged into main
- pnpm workspace, strict TypeScript configuration, Next.js dashboard and NestJS API.
- PostgreSQL/pgvector and Redis local infrastructure.
- Core Drizzle schema and reviewed SQL migrations for users, workspaces, consent, sources, memories, evidence, entities, audit logs and Better Auth identities/sessions.
- Transactional migration runner with advisory locking and applied-migration tracking.
- Better Auth email/password authentication, mandatory email verification, password reset, database-backed sessions and session revocation.
- API global session guard, public health routes and protected account endpoints.
- Personal user/workspace/owner-membership provisioning, workspace metadata, unique personal workspace ownership and reversible archive/restore.
- Shared workspace management, owner/admin/member/viewer RBAC, invitation tokens and verified-email acceptance.
- PostgreSQL forced RLS policies, restricted runtime role guidance, transaction-local tenant context and cross-tenant negative tests.

## In progress: MEM-015 source and source chunk models
- Workspace-scoped source metadata API: create, list, detail and archive.
- SHA-256 checksum validation and source provenance metadata.
- Atomic chunk-set replacement and ordered chunk retrieval.
- RLS context and active workspace membership required for every source endpoint.
- Database integration tests for tenant visibility and source/chunk workspace integrity.
- Binary upload/object storage is deliberately deferred; no client-controlled storage key is accepted.

## Validation status
Changes are authored through the GitHub integration. No local dependency installation, typecheck, build or PostgreSQL runtime execution has been performed in this session. GitHub Actions workflows for previous milestones, including MEM-014, ended in `startup_failure` before creating jobs; therefore no successful automated validation is available. Treat the current MEM-015 branch as unvalidated until the commands in the repository CI workflow complete successfully.

## Not yet implemented
Binary upload and EU object storage, ingestion workers (parsing/OCR/transcription), memory CRUD and evidence API, AI extraction and recall, entity resolution and knowledge graph API, audit event integration, external connectors, mobile and desktop clients, retention/deletion workflows, account deletion/email change and production hardening.
