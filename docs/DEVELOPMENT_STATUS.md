# Development Status

Updated: 2026-11-16

## Repository
- Private GitHub repository: moonback/MEMORA.
- Initial application foundation merged into `main` via PR #9.
- API liveness/readiness and health tests merged into `main` via PR #20.
- Core PostgreSQL schema and migration runner merged via PR #21.
- Current implementation branch: `feature/MEM-010-authentication-sessions`.

## Merged into main
- pnpm workspace and strict TypeScript base config.
- Next.js dashboard shell.
- NestJS API with public liveness/readiness endpoints.
- PostgreSQL/pgvector and Redis local infrastructure.
- Core Drizzle schema and reviewed SQL migration for users, workspaces, consent, sources, memories, evidence, entities and audit logs.
- Transactional migration runner with advisory locking and applied-migration tracking.
- Product, architecture, security, database and roadmap documentation.

## In progress: MEM-010 authentication and sessions
- Integrated Better Auth with PostgreSQL persistence and database-backed sessions.
- Added email/password signup and signin, mandatory email verification, password reset and session revocation after password reset.
- Added SMTP delivery adapter and documented required environment variables.
- Added a NestJS global session guard, explicit public-route decorator for health endpoints, and protected `GET /api/account/me`.
- Added signup lifecycle provisioning for the MEMORA UUID user, personal workspace and owner membership.
- Added web login/signup and password-reset screens.
- Added SQL migration `0002_authentication.sql` for Better Auth identity, session, account and verification tables.
- Configured the API as ESM because Better Auth's Node integration documents ESM as a requirement.

## Validation status
GitHub integration was used to author changes; no local dependency installation or runtime execution has been performed. PR #21 was merged at user request although its previous CI run failed before starting any job (`startup_failure`, zero jobs). MEM-010 has not yet been typechecked, built, or run against PostgreSQL. Do not treat authored tests as passing tests. SMTP credentials and a strong production `BETTER_AUTH_SECRET` must be configured before production use.

## Not yet implemented
Workspace authorization and PostgreSQL RLS policies, workspace APIs, profile/account settings, source ingestion, memory CRUD, AI extraction and recall, external connectors, mobile and desktop clients, retention/deletion workflows, and production hardening.
