# Development Status

Updated: 2026-11-16

## Repository
- Private GitHub repository: moonback/MEMORA.
- The initial foundation has been squash-merged into `main` via PR #9.
- Active implementation branch: `feature/MEM-008-health-smoke-tests`.

## Implemented on main
- pnpm workspace and strict TypeScript base config.
- Next.js dashboard shell.
- NestJS API with `GET /api/health` liveness endpoint.
- Shared Zod domain contracts.
- Initial Drizzle users/workspaces schema.
- Docker Compose for PostgreSQL pgvector and Redis.
- Product, architecture, security and roadmap documentation.

## In progress on feature/MEM-008-health-smoke-tests
- Add `GET /api/health/ready` to report database and Redis TCP reachability.
- Keep liveness independent from infrastructure so the process can be monitored during dependency outages.
- Add automated tests for healthy, degraded, missing configuration, malformed URLs and TCP probing.
- Replace the API's placeholder test command with the Node test runner through tsx.

## Validation status
The initial foundation's dependencies have not yet been installed or built in a local runtime. The first CI workflow run ended with `startup_failure`; no passing build or test result is available yet. The readiness implementation is being prepared for CI validation in its pull request.

## Not yet implemented
Production authentication, workspace authorization/RLS, sources and memories APIs, ingestion, AI, connectors, mobile and desktop clients.
