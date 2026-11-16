# Development Status

Updated: 2026-11-16

## Repository
- Private GitHub repository: moonback/MEMORA.
- Initial application foundation merged into `main` via PR #9.
- API liveness/readiness and health tests merged into `main` via PR #20.
- Current implementation branch: `feature/MEM-009-database-schema-migrations`.

## Merged into main
- pnpm workspace and strict TypeScript base config.
- Next.js dashboard shell.
- NestJS API with `GET /api/health` liveness and `GET /api/health/ready` dependency readiness.
- Readiness tests for healthy, degraded, unconfigured and TCP probe scenarios.
- Shared Zod domain contracts.
- Docker Compose for PostgreSQL pgvector and Redis.
- Product, architecture, security and roadmap documentation.

## In progress: MEM-009 database schema and migrations
- Expanded Drizzle schema for users, workspaces, memberships, invitations, consent, sources, source chunks, memories, evidence, entities, entity links, entity relations and audit logs.
- Added reviewed initial SQL migration with pgvector extension, enums, constraints and indexes.
- Added a transaction-based migration runner with advisory locking and applied-migration tracking.
- Added PostgreSQL integration tests for migration tables and cross-workspace foreign-key rejection.
- Updated CI to start a pgvector PostgreSQL service, apply migrations, and run typecheck, tests and build.

## Validation status
The GitHub integration was used to author these changes; no local dependency installation or runtime execution has been performed. PR #20 was merged, but its commit had no GitHub check runs. The MEM-009 branch must pass CI before it is merged. Do not treat authored tests as passing tests.

## Not yet implemented
Production authentication/session lifecycle, workspace authorization and RLS policies, workspace APIs, source ingestion, memory CRUD, AI extraction and recall, external connectors, mobile and desktop clients, retention/deletion workflows, and production hardening.
