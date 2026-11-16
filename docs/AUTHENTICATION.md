# Authentication & Sessions

## Provider and persistence
MEMORA uses Better Auth with its PostgreSQL adapter. The Better Auth identity (`user`) is separate from the application-domain `users` record: `users.auth_user_id` links the two while preserving the domain UUID used by workspace and memory foreign keys.

The `0002_authentication.sql` migration creates the Better Auth `user`, `session`, `account` and `verification` tables. Sessions are database-backed, not stateless JWTs. Better Auth owns password hashing, credential verification, verification tokens, reset tokens, cookie issuance and session invalidation.

## Supported flows
- Email/password sign-up and sign-in.
- Mandatory email verification before sign-in.
- Password reset by single-use email token.
- Password reset revokes existing sessions.
- Sign-out revokes the current session.
- `GET /api/account/me` returns the authenticated identity and current session.
- All NestJS routes require a valid session by default. Only endpoints marked with `@Public()` are anonymous; the two health endpoints are public.

## Personal workspace provisioning
After Better Auth creates an identity, a database hook creates or links the UUID-based MEMORA user profile, creates a personal workspace if one does not exist, and adds the user as its `owner`. These operations use one PostgreSQL transaction.

## Browser and API
- Web origin: `WEB_ORIGIN` (default `http://localhost:3000`).
- API origin: `BETTER_AUTH_URL` / `NEXT_PUBLIC_API_URL` (default `http://localhost:4000`).
- Auth endpoints: `/api/auth/*`.
- Session cookies are HTTP-only, same-site lax, and secure in production.
- CORS allows the configured web origin and credentials.

## Required configuration
Copy `.env.example` to `.env`. Set a unique random `BETTER_AUTH_SECRET` of at least 32 characters and configure an SMTP relay before enabling signup or password reset. Production must use HTTPS, a strong secret, and a real SMTP sender domain.

SMTP settings:
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM` are required to deliver mail.
- `SMTP_USER` and `SMTP_PASSWORD` are optional for relays using IP authentication.

The development fallback secret is for local work only and must never be used in production.

## Local setup
1. Copy `.env.example` to `.env` and set `BETTER_AUTH_SECRET`.
2. Configure SMTP values to receive verification and reset messages.
3. Start PostgreSQL and Redis with `docker compose up -d`.
4. Apply migrations with `pnpm db:migrate`.
5. Install dependencies and start the API and web apps with `pnpm install` and `pnpm dev`. If Next.js does not load the monorepo root `.env`, copy `NEXT_PUBLIC_API_URL` into `apps/web/.env.local`.
6. Open `http://localhost:3000/login`.

## Security boundaries
This milestone adds authentication, not workspace authorization. Authentication confirms who the caller is; it does not yet prove membership in a requested workspace. Workspace-scoped authorization and PostgreSQL RLS remain separate milestones (MEM-013/MEM-014). Do not expose workspace data endpoints until those controls are implemented.
