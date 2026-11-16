# MEMORA — Personal Memory OS

MEMORA is a privacy-first personal memory platform. It captures information with explicit user consent, structures it into traceable memories, and retrieves answers grounded in their original sources.

## Product principles

- Selective capture and explicit consent.
- European hosting target and GDPR-oriented data controls.
- Workspace-scoped data isolation.
- Every extracted memory retains provenance and temporal context.
- Uncertain or disputed information is never silently promoted to fact.
- AI providers remain interchangeable.
- Web first, with mobile and desktop clients planned on shared contracts.

## Architecture

- **Web:** Next.js App Router, React, TypeScript.
- **API:** NestJS modular monolith.
- **Database:** PostgreSQL + pgvector, Drizzle ORM.
- **Jobs:** Redis + BullMQ.
- **Contracts:** shared TypeScript + Zod.
- **Tests:** Vitest and Playwright.
- **Workspace:** pnpm monorepo.

## Development

Requirements: Node.js 22+, pnpm 10+, Docker Compose.

```powershell
corepack enable
pnpm install
Copy-Item .env.example .env
docker compose up -d
pnpm dev
```

Web: http://localhost:3000  
API: http://localhost:4000  
API health: http://localhost:4000/health

## Repository workflow

- `main`: stable releases.
- `develop`: integration.
- `feature/MEM-XXX-description`: feature work.
- `fix/MEM-XXX-description`: fixes.

Never commit secrets. All workspace data access must be authorized server-side and protected by PostgreSQL row-level security in production.

## Status

The repository is being bootstrapped. See [docs/ROADMAP.md](docs/ROADMAP.md) and [docs/DEVELOPMENT_STATUS.md](docs/DEVELOPMENT_STATUS.md).
