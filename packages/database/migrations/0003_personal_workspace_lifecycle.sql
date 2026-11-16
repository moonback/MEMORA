-- Personal workspace metadata and reversible lifecycle state.
ALTER TABLE workspaces
  ADD COLUMN description varchar(500),
  ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN archived_at timestamptz;

-- A user can own at most one personal workspace. Shared workspaces are unaffected.
CREATE UNIQUE INDEX workspaces_one_personal_per_owner_unique
  ON workspaces(owner_user_id)
  WHERE type = 'personal';
