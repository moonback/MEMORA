# Development Status

Updated: 2026-11-17

## Repository

- Private GitHub repository: moonback/MEMORA.
- Foundation merged via PR #9; health/readiness via PR #20.
- Core schema via PR #21; authentication via PR #22; profile/settings via PR #23.
- Workspace lifecycle via PR #24; membership/RBAC via PR #25; PostgreSQL RLS via PR #29.
- Sources/chunks via PR #30; memories/evidence via PR #31; entities/relations via PR #32.
- Audit log/security tests via PR #34.
- EU object metadata via PR #36; private object storage adapter via PR #38.
- Object upload expiry/cleanup via PR #40.
- Manual capture and source library via PR #41, squash commit `e53dc556a7b0cfcbc0c73c773624660391cef4e9`.
- Current implementation branch: `feature/MEM-023-binary-file-import`; issue #42.

## Merged capabilities

- pnpm monorepo, strict TypeScript, Next.js web app and NestJS modular API.
- PostgreSQL/pgvector, Redis local infrastructure and transactional migration runner.
- Better Auth sessions, protected API routes, profile and account settings.
- Personal/shared workspaces, invitations, owner/admin/member/viewer RBAC and forced PostgreSQL RLS.
- Workspace-scoped source metadata, chunks and provenance; atomic manual note capture and source library.
- Workspace-scoped memories, evidence, supersession, entities and typed temporal relations.
- Append-only transactional audit log with minimized metadata.
- S3-compatible private storage, server-generated object keys, presigned upload/download, object verification, expiry leases and idempotent cleanup.

## User-reported validation

- MEM-016: DB 18/18, API 43/43, typecheck and builds passed locally.
- MEM-017: DB 21/21, API 48/48, typecheck and builds passed locally; GitHub Actions startup failure.
- MEM-018: DB 25/25, API 48/48, typecheck and build passed locally; GitHub Actions startup failure.
- MEM-021: after corrective commit `95d6273`, typecheck passed; PostgreSQL 30/30 and API 57/57 passed with zero failures/skips; API and Next.js production builds passed.
- MEM-022: user reported typecheck and production build passed; PostgreSQL 32/32 and API 60/60 passed with zero failures/skips. Web/Shared test scripts remain placeholders.

## In progress: MEM-025 text extraction and normalization

- Branch `feature/MEM-025-text-extraction-normalization` (uncommitted working tree on top of `e6382f1`).
- `SourceTextExtractionProcessor` replaces the unconfigured processor: verified TXT/Markdown objects are read through `readObject` (size + SHA-256), strictly decoded as UTF-8, normalized (NFC, LF, control characters, blank lines) and chunked deterministically (≤ 2,000 chars, paragraph-aware, no overlap).
- Processor runs on the restricted `memora_app` pool with transaction-local `app.workspace_id`; RLS is enforced. The worker's own `DATABASE_SYSTEM_URL` fallback is a superuser locally (documented follow-up).
- Additive migration `0012_source_chunk_versions.sql`: `is_current` + partial unique index. Chunk replacement (processor and `PUT …/chunks`) retires instead of deleting; historical evidence stays readable. Not applied to the shared `memora` database.
- Local validation on isolated `memora_mem025_test` / `memora_ingestion_test`: API 97/97 and PostgreSQL 35/35 with zero failures/skips (including MEM-024 Redis/BullMQ integration and 10 new MEM-025 integration tests); typecheck, lint and build passed.
- Remaining: apply 0012 after review, PDF parser selection, dedicated least-privilege worker role. See [TEXT_EXTRACTION.md](TEXT_EXTRACTION.md).

## In progress: MEM-024 durable ingestion foundation

- Issue #44; branch `feature/MEM-024-durable-ingestion-orchestration`.
- Migration `0011_source_ingestion_outbox.sql` adds workspace-scoped ingestion lifecycle and a restricted transactional outbox.
- Source readiness and verified object completion create one idempotent outbox event in the same PostgreSQL transaction.
- Verified binary objects automatically transition their source to ready; manual capture already uses the ready transition.
- Source list/detail API responses expose the latest ingestion state and bounded attempt metadata.
- Added PostgreSQL integration coverage for transaction rollback, idempotent enqueue, verified-object transition and tenant visibility.
- Follow-up #45 / branch `feature/MEM-024b-bullmq-outbox-worker`: BullMQ dispatcher and worker skeleton added; default processor fails explicitly with `processor_unavailable` until a real extraction processor is registered. Local typecheck, PostgreSQL/Redis integration tests and build still required.
- Local migration, typecheck, test and build validation pending.

## In progress: MEM-023 secure binary file import

- Issue #42; branch `feature/MEM-023-binary-file-import`.
- Adds PDF, DOCX, TXT and Markdown file selection/dropzone with a 100 MiB client-side limit.
- Calculates SHA-256 in the browser, creates a workspace-scoped document source, requests a short-lived presigned URL, uploads directly to private S3-compatible storage with progress, and asks the API to verify the object.
- Supports cancelling the browser transfer and retrying a failed PUT while its temporary URL remains valid.
- Adds upload documentation and updates backlog/roadmap.
- Local typecheck, PostgreSQL/API test and production build validation pending.
- File content extraction, OCR, malware scanning, indexing and AI processing are explicitly out of scope.

## Known gaps

- The Web and Shared package test scripts are placeholders; dedicated UI tests are not yet configured.
- Durable ingestion orchestration, parsing/OCR/transcription, AI extraction, hybrid recall, connectors, GDPR export/erasure UX, mobile/desktop clients and production hardening remain future work.
- GitHub Actions has previously reported startup failures; do not treat local validation as CI evidence.
