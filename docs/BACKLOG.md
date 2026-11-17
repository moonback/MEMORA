# Backlog

## Foundation
- [ ] MEM-001 Repository governance and documentation
- [ ] MEM-002 pnpm monorepo and TypeScript configuration
- [ ] MEM-003 Next.js Web and NestJS API bootstrap
- [ ] MEM-004 Shared contracts and validation
- [ ] MEM-005 PostgreSQL/pgvector and Redis local infrastructure
- [ ] MEM-006 Quality gates and CI
- [ ] MEM-007 Codex instructions and technical documentation
- [ ] MEM-008 Health checks and smoke tests

## Identity & Memory Core
- [x] MEM-009 Database schema and migrations
- [x] MEM-010 Authentication
- [x] MEM-011 User profile and account settings
- [x] MEM-012 Personal workspace lifecycle
- [x] MEM-013 Workspace membership and RBAC
- [x] MEM-014 PostgreSQL RLS and tenant isolation
- [x] MEM-015 Source and source chunk models
- [x] MEM-016 Memory model and evidence provenance
- [x] MEM-017 Entity and knowledge relations
- [x] MEM-018 Append-only audit log and security integration tests
- [x] MEM-019 EU object storage metadata and presigned upload
- [x] MEM-020 Private object storage adapter and secure upload workflow
- [x] MEM-021 Object upload expiry, cleanup and lifecycle security tests

## Capture Engine
- [x] MEM-022 Manual capture and source library (merged PR #41)
- [~] MEM-023 Binary file import UX and upload progress (implementation branch; local validation pending)
- [~] MEM-024 Durable ingestion state, transactional outbox and tenant-visible status (PR #44 merged); BullMQ dispatcher/worker follow-up #45 in progress

## Intelligence & Recall
- [~] MEM-025 Text extraction and normalization pipeline (TXT/Markdown, versioned chunks; branch `feature/MEM-025-text-extraction-normalization`; PDF pending)
- [ ] MEM-026 AI memory extraction with evidence references
- [ ] MEM-027 Hybrid search and grounded recall
