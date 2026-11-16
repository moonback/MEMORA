# Development Status

Updated: 2026-11-16

## Repository
- Private GitHub repository: moonback/MEMORA.
- Foundation merged via PR #9.
- Health/readiness endpoints merged via PR #20.
- Core database schema and migrations merged via PR #21.
- Authentication and sessions merged via PR #22.
- Current implementation branch: `feature/MEM-011-profile-account-settings`.

## Merged into main
- pnpm workspace, strict TypeScript configuration, Next.js dashboard and NestJS API.
- PostgreSQL/pgvector and Redis local infrastructure.
- Core Drizzle schema and reviewed SQL migrations for users, workspaces, consent, sources, memories, evidence, entities, audit logs and Better Auth identities/sessions.
- Transactional migration runner with advisory locking and applied-migration tracking.
- Better Auth email/password authentication, mandatory email verification, password reset, database-backed sessions and session revocation.
- API global session guard, public health routes and protected account endpoint.
- Personal user/workspace/owner-membership provisioning on account creation.
- Web signup/login, password reset, dashboard auth gate and sign-out.

## In progress: MEM-011 profile and account settings
- Expanded `GET /api/account/me` to return the auth identity, MEMORA profile, personal workspace and current session.
- Added validated `PATCH /api/account/me` for display name, locale and IANA time zone; auth and domain profile names update transactionally.
- Added web settings page for profile preferences, password changes and active session revocation.
- Password changes verify the current password and revoke other active sessions.
- Added profile validation tests and account settings documentation.

## Validation status
GitHub integration authored all changes; no local dependency installation, typecheck, build or runtime execution has been performed. GitHub Actions runs on PR #21 and PR #22 both ended in `startup_failure` before creating any jobs; no test or build result exists. MEM-011 is not yet validated. Do not treat authored tests as passing tests. Configure SMTP and a unique production `BETTER_AUTH_SECRET` before production use.

## Not yet implemented
Workspace authorization and PostgreSQL RLS policies, workspace membership/RBAC APIs, source ingestion, memory CRUD, AI extraction and recall, external connectors, mobile and desktop clients, retention/deletion workflows, account deletion/email change and production hardening.
