# Architecture

MEMORA starts as a modular monolith in a pnpm TypeScript monorepo.

- apps/web: Next.js App Router.
- apps/api: NestJS API.
- packages/shared: Zod contracts shared by clients and API.
- packages/database: Drizzle schema and migrations.
- PostgreSQL + pgvector: durable data and vector search.
- Redis + BullMQ: asynchronous processing.

The API is authoritative for identity, authorization and workspace access. Clients never connect directly to PostgreSQL.
