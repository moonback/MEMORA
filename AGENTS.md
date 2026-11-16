# MEMORA — Codex Instructions

MEMORA is a privacy-first Personal Memory OS. Core flow: CAPTURE → INGESTION → UNDERSTANDING → MEMORY → SEARCH → GROUNDED RECALL.

## Architecture
- pnpm TypeScript monorepo; Next.js App Router; NestJS modular monolith.
- PostgreSQL + pgvector; Drizzle ORM; Redis + BullMQ.
- Shared TypeScript/Zod contracts.
- Mobile and Desktop are planned clients, not yet implemented.

## Product rules
- Selective capture and explicit consent; European hosting target.
- Multi-tenant workspace isolation.
- Every source-derived memory preserves provenance.
- Keep recorded time, event time and validity time distinct.
- Preserve contradictions; never present uncertain information as confirmed.
- AI providers remain interchangeable.

## Engineering rules
1. Inspect repo and Git status before editing; read relevant docs.
2. Never work directly on main; use dedicated feature branches and Issues.
3. Validate external inputs; never commit secrets or real user data.
4. Never bypass tenant authorization or RLS.
5. Add tests for important business behavior.
6. Never disable tests or invent test results.
7. Update docs and DEVELOPMENT_STATUS.md.

## Quality gates
Run applicable commands: pnpm lint, pnpm typecheck, pnpm test, pnpm build.
Definition of Done: acceptance criteria, real tests, lint/typecheck/build, security review and truthful docs.

## Git
main = stable; develop = integration; feature/MEM-XXX-description = feature work; fix/MEM-XXX-description = fixes. PRs target develop.