-- MEM-010/011/012 schema reconciliation.
-- The original core migration predates the Better Auth and workspace lifecycle
-- controllers. Add the columns and identity tables required by the current API.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS auth_user_id varchar(64);

CREATE UNIQUE INDEX IF NOT EXISTS users_auth_user_id_unique
  ON public.users(auth_user_id);

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS description varchar(500),
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS workspaces_one_personal_per_owner_unique
  ON public.workspaces(owner_user_id)
  WHERE type = 'personal';

-- Better Auth's default PostgreSQL adapter schema.
CREATE TABLE IF NOT EXISTS public."user" (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  "emailVerified" boolean NOT NULL DEFAULT false,
  image text,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.session (
  id text PRIMARY KEY,
  "expiresAt" timestamp NOT NULL,
  token text NOT NULL UNIQUE,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now(),
  "ipAddress" text,
  "userAgent" text,
  "userId" text NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS session_user_id_idx ON public.session("userId");

CREATE TABLE IF NOT EXISTS public.account (
  id text PRIMARY KEY,
  "accountId" text NOT NULL,
  "providerId" text NOT NULL,
  "userId" text NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" timestamp,
  "refreshTokenExpiresAt" timestamp,
  scope text,
  password text,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS account_user_id_idx ON public.account("userId");
CREATE UNIQUE INDEX IF NOT EXISTS account_provider_account_unique
  ON public.account("providerId", "accountId");

CREATE TABLE IF NOT EXISTS public.verification (
  id text PRIMARY KEY,
  identifier text NOT NULL,
  value text NOT NULL,
  "expiresAt" timestamp NOT NULL,
  "createdAt" timestamp DEFAULT now(),
  "updatedAt" timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS verification_identifier_idx ON public.verification(identifier);

COMMENT ON COLUMN public.users.auth_user_id IS 'Foreign identity key managed by Better Auth; domain user UUID remains the tenant principal.';
COMMENT ON COLUMN public.workspaces.archived_at IS 'Soft-archive timestamp; archived workspaces are denied by the membership guard and RLS context helper.';
