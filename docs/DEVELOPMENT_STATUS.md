# Development Status

Updated: 2026-11-16

## Repository
- Private GitHub repository: moonback/MEMORA.
- Foundation merged via PR #9.
- Health/readiness endpoints merged via PR #20.
- Core database schema and migrations merged via PR #21.
- Authentication and sessions merged via PR #22.
- Profile and account settings merged via PR #23.
- Personal workspace lifecycle merged via PR #24.
- MEM-013 merged via PR #27 (RBAC, invitations and shared workspace management).
- MEM-014 pull request: #29 (open; awaiting a real CI run).
- Current implementation branch: `feature/MEM-014-rls-isolation`.

## Merged into main
- pnpm workspace, strict TypeScript configuration, Next.js dashboard and NestJS API.
- PostgreSQL/pgvector and Redis local infrastructure.
- Core Drizzle schema and reviewed SQL migrations for users, workspaces, consent, sources, memories, evidence, entities, audit logs and Better Auth identities/sessions.
- Transactional migration runner with advisory locking and applied-migration tracking.
- Better Auth email/password authentication, mandatory email verification, password reset, database-backed sessions and session revocation.
- API global session guard, public health routes and protected account endpoints.
- Personal user/workspace/owner-membership provisioning, workspace metadata, unique personal workspace ownership and reversible archive/restore.
- Web signup/login, password reset, authenticated dashboard, account settings and workspace lifecycle screens.

## Merged: MEM-013 workspace membership and RBAC
- Shared workspace creation and membership listing.
- Owner/admin/member/viewer role policy and active-membership guard for workspace-scoped routes.
- Member listing, role changes, removal and self-leave; prevent owner removal/leave.
- Email invitations with 256-bit URL-safe tokens, SHA-256 hash persistence, seven-day expiry and verified-email acceptance.
- Invitation revocation and admin/owner policy checks.
- Web shared workspace management and invitation acceptance flows.
- RBAC policy, token and request-schema tests plus documentation.

## In progress: MEM-014 PostgreSQL RLS and tenant isolation
- Add forced RLS policies for domain tables and invitation-recipient reads.
- Add transaction-local user/workspace context helpers and scope API operations.
- Use a restricted runtime database role separate from migration credentials.
- Add negative cross-tenant integration tests.

## Validation status
GitHub integration authored all changes; no local dependency installation, typecheck, build or PostgreSQL runtime execution has been performed. GitHub Actions runs on PR #21, PR #22 and PR #23 ended in `startup_failure` before creating any jobs; MEM-012 was merged under explicit user direction with no CI jobs available. MEM-013 was merged in PR #27; CI remained unavailable due to startup_failure. MEM-014 is in PR #29 and not yet validated; GitHub Actions run #288 ended in `startup_failure` with zero jobs. Configure SMTP and a unique production `BETTER_AUTH_SECRET` before production use.

## Not yet implemented
Owner transfer, audit events for membership changes, invitation email delivery retries/throttling, source ingestion, memory CRUD, AI extraction and recall, external connectors, mobile and desktop clients, retention/deletion workflows, account deletion/email change and production hardening.
