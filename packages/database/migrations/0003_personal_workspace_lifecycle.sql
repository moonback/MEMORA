-- Personal workspace metadata and reversible lifecycle state.
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS description varchar(500),
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- A user can own at most one personal workspace. Shared workspaces are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS workspaces_one_personal_per_owner_unique
  ON workspaces(owner_user_id)
  WHERE type = 'personal';
