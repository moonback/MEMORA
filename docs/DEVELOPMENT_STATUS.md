# Development Status

Updated: 2026-11-16

## Repository
- Private GitHub repository: moonback/MEMORA.
- Foundation merged via PR #9; health/readiness via PR #20.
- Core schema via PR #21; authentication via PR #22; profile/settings via PR #23.
- Workspace lifecycle via PR #24; membership/RBAC via PR #25; PostgreSQL RLS via PR #29.
- Sources/chunks via PR #30; memories/evidence via PR #31; entities/relations via PR #32.
- Audit log/security tests via PR #34.
- EU object metadata via PR #36; private object storage adapter via PR #38.
- Object upload expiry/cleanup via PR #40 (squash commit `c69a291a43df86cd0b59bb7f66129002a78cdcbf`).
- Current implementation branch: `feature/MEM-022-manual-capture-source-library`; PR pending local validation.

## Merged capabilities
- pnpm monorepo, strict TypeScript, Next.js web app and NestJS modular API.
- PostgreSQL/pgvector, Redis local infrastructure and transactional migration runner.
- Better Auth sessions, protected API routes, profile and account settings.
- Personal/shared workspaces, invitations, owner/admin/member/viewer RBAC and forced PostgreSQL RLS.
- Workspace-scoped source metadata, chunks and provenance.
- Workspace-scoped memories, evidence, supersession, entities and typed temporal relations.
- Append-only transactional audit log with minimized metadata.
- S3-compatible private storage, server-generated object keys, presigned upload/download, object verification, expiry leases and idempotent cleanup.

## User-reported validation
- MEM-016: DB 18/18, API 43/43, typecheck and builds passed locally.
- MEM-017: DB 21/21, API 48/48, typecheck and builds passed locally; GitHub Actions startup failure.
- MEM-018: DB 25/25, API 48/48, typecheck and build passed locally; GitHub Actions startup failure.
- MEM-021: after corrective commit `95d6273`, typecheck passed; PostgreSQL 30/30 and API 57/57 passed with zero failures/skips; API and Next.js production builds passed. Next.js emitted a non-blocking multiple-lockfiles workspace-root warning.

## In progress: MEM-022 manual capture and source library
- Adds a strict manual-note endpoint that creates source metadata, original-content chunk and ready state in one workspace-scoped transaction.
- Adds a workspace source-library page with note creation, source list and original content view.
- Adds API contract tests and PostgreSQL transaction/rollback tests.
- Local typecheck, test and build validation remains pending.

## Known gaps
- The Web and Shared package test scripts are placeholders; dedicated UI tests are not yet configured.
- Binary file import UI, parsing/OCR/transcription, durable ingestion orchestration, AI extraction, hybrid recall, connectors, GDPR export/erasure UX, mobile/desktop clients and production hardening remain future work.
- GitHub Actions has previously reported startup failures; do not treat local validation as CI evidence.
