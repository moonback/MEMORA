# Development Status

Updated: 2026-11-16

## Repository
- Private GitHub repository: moonback/MEMORA.
- Foundation merged via PR #9.
- Health/readiness endpoints merged via PR #20.
- Core database schema and migrations merged via PR #21.
- Authentication and sessions merged via PR #22.
- Profile and account settings merged via PR #23.
- Current implementation branch: `feature/MEM-012-personal-workspace-lifecycle`.

## Merged into main
- pnpm workspace, strict TypeScript configuration, Next.js dashboard and NestJS API.
- PostgreSQL/pgvector and Redis local infrastructure.
- Core Drizzle schema and reviewed SQL migrations for users, workspaces, consent, sources, memories, evidence, entities, audit logs and Better Auth identities/sessions.
- Transactional migration runner with advisory locking and applied-migration tracking.
- Better Auth email/password authentication, mandatory email verification, password reset, database-backed sessions and session revocation.
- API global session guard, public health routes and protected account endpoint.
- Personal user/workspace/owner-membership provisioning on account creation.
- Web signup/login, password reset, dashboard auth gate and sign-out.
- User profile preferences, password changes and active-session management.

## In progress: MEM-012 personal workspace lifecycle
- Added workspace description, JSON metadata and reversible archive timestamp in migration `0003_personal_workspace_lifecycle.sql`.
- Added a partial unique index enforcing at most one personal workspace per owner.
- Extracted an idempotent `ensurePersonalWorkspace` provisioner shared by signup and the authenticated API.
- Added authenticated GET, ensure, update, archive and restore routes for the caller's personal workspace only.
- Added workspace metadata validation, integration/schema tests and settings UI for workspace details and archive/restore.
- Corrected the verification email callback to use the non-blocking mail queue introduced in MEM-010.

## Validation status
GitHub integration authored all changes; no local dependency installation, typecheck, build or PostgreSQL runtime execution has been performed. GitHub Actions runs on PR #21, PR #22 and PR #23 ended in `startup_failure` before creating any jobs; no test or build result exists. MEM-012 is not yet validated. Configure SMTP and a unique production `BETTER_AUTH_SECRET` before production use.

## Not yet implemented
Workspace membership invitations and RBAC, PostgreSQL RLS policies and per-request tenant context, source ingestion, memory CRUD, AI extraction and recall, external connectors, mobile and desktop clients, retention/deletion workflows, account deletion/email change and production hardening.
