-- MEMORA initial relational domain schema.
-- Workspace ownership is enforced with composite foreign keys. RLS policies are
-- introduced separately with the tenant-isolation implementation (MEM-014).

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TYPE workspace_type AS ENUM ('personal', 'shared');
CREATE TYPE workspace_role AS ENUM ('owner', 'admin', 'member', 'viewer');
CREATE TYPE membership_status AS ENUM ('active', 'invited', 'suspended');
CREATE TYPE source_type AS ENUM ('document', 'email', 'audio', 'note', 'image', 'manual', 'web_clip');
CREATE TYPE source_status AS ENUM ('pending', 'processing', 'ready', 'failed', 'archived');
CREATE TYPE memory_type AS ENUM ('fact', 'preference', 'event', 'decision', 'commitment', 'note', 'observation');
CREATE TYPE memory_status AS ENUM ('active', 'superseded', 'archived');
CREATE TYPE consent_status AS ENUM ('granted', 'revoked');
CREATE TYPE entity_type AS ENUM ('person', 'organization', 'place', 'project', 'product', 'topic', 'other');
CREATE TYPE relation_type AS ENUM ('related_to', 'works_with', 'member_of', 'located_in', 'part_of', 'owns', 'replaces', 'depends_on', 'custom');

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email varchar(320) NOT NULL UNIQUE,
  display_name varchar(160),
  locale varchar(16) NOT NULL DEFAULT 'fr-FR',
  time_zone varchar(64) NOT NULL DEFAULT 'Europe/Paris',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(120) NOT NULL,
  slug varchar(140) NOT NULL UNIQUE,
  type workspace_type NOT NULL DEFAULT 'personal',
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspaces_id_owner_unique UNIQUE (id, owner_user_id)
);
CREATE INDEX workspaces_owner_idx ON workspaces(owner_user_id);

CREATE TABLE workspace_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role workspace_role NOT NULL DEFAULT 'member',
  status membership_status NOT NULL DEFAULT 'active',
  joined_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_members_workspace_user_unique UNIQUE (workspace_id, user_id)
);
CREATE INDEX workspace_members_user_idx ON workspace_members(user_id);

CREATE TABLE workspace_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email varchar(320) NOT NULL,
  role workspace_role NOT NULL DEFAULT 'member',
  token_hash varchar(128) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  invited_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX workspace_invitations_pending_unique ON workspace_invitations(workspace_id, email) WHERE accepted_at IS NULL;
CREATE INDEX workspace_invitations_expiry_idx ON workspace_invitations(expires_at);

CREATE TABLE consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose varchar(80) NOT NULL,
  status consent_status NOT NULL,
  policy_version varchar(40) NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  decided_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX consents_workspace_user_purpose_idx ON consents(workspace_id, user_id, purpose, decided_at);

CREATE TABLE sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  type source_type NOT NULL,
  status source_status NOT NULL DEFAULT 'pending',
  title varchar(500),
  original_name varchar(500),
  mime_type varchar(160),
  storage_key text,
  checksum_sha256 varchar(64),
  external_provider varchar(80),
  external_id varchar(512),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  captured_at timestamptz,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sources_id_workspace_unique UNIQUE (id, workspace_id)
);
CREATE INDEX sources_workspace_created_idx ON sources(workspace_id, created_at);
CREATE INDEX sources_workspace_status_idx ON sources(workspace_id, status);
CREATE UNIQUE INDEX sources_external_identity_unique ON sources(workspace_id, external_provider, external_id) WHERE external_provider IS NOT NULL AND external_id IS NOT NULL;

CREATE TABLE source_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  source_id uuid NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  content text NOT NULL,
  token_count integer,
  page_number integer,
  time_start_ms integer,
  time_end_ms integer,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT source_chunks_source_workspace_fk FOREIGN KEY (source_id, workspace_id) REFERENCES sources(id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT source_chunks_source_ordinal_unique UNIQUE (source_id, ordinal),
  CONSTRAINT source_chunks_id_workspace_unique UNIQUE (id, workspace_id)
);
CREATE INDEX source_chunks_workspace_source_idx ON source_chunks(workspace_id, source_id);

CREATE TABLE memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  type memory_type NOT NULL,
  status memory_status NOT NULL DEFAULT 'active',
  content text NOT NULL,
  summary varchar(1000),
  confidence integer CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 100)),
  occurred_at timestamptz,
  valid_from timestamptz,
  valid_until timestamptz,
  supersedes_memory_id uuid,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT memories_id_workspace_unique UNIQUE (id, workspace_id),
  CONSTRAINT memories_supersedes_workspace_fk FOREIGN KEY (supersedes_memory_id, workspace_id) REFERENCES memories(id, workspace_id),
  CONSTRAINT memories_validity_range CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until >= valid_from)
);
CREATE INDEX memories_workspace_status_created_idx ON memories(workspace_id, status, created_at);
CREATE INDEX memories_workspace_type_idx ON memories(workspace_id, type);

CREATE TABLE memory_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  memory_id uuid NOT NULL,
  source_chunk_id uuid NOT NULL,
  evidence_type varchar(40) NOT NULL DEFAULT 'supports',
  quote text,
  confidence integer CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 100)),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT memory_evidence_memory_workspace_fk FOREIGN KEY (memory_id, workspace_id) REFERENCES memories(id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT memory_evidence_chunk_workspace_fk FOREIGN KEY (source_chunk_id, workspace_id) REFERENCES source_chunks(id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT memory_evidence_memory_chunk_type_unique UNIQUE (memory_id, source_chunk_id, evidence_type)
);
CREATE INDEX memory_evidence_workspace_memory_idx ON memory_evidence(workspace_id, memory_id);

CREATE TABLE entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  type entity_type NOT NULL,
  canonical_name varchar(300) NOT NULL,
  description text,
  aliases jsonb NOT NULL DEFAULT '[]'::jsonb,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT entities_id_workspace_unique UNIQUE (id, workspace_id)
);
CREATE UNIQUE INDEX entities_workspace_type_name_unique ON entities(workspace_id, type, lower(canonical_name));
CREATE INDEX entities_workspace_type_idx ON entities(workspace_id, type);

CREATE TABLE memory_entities (
  workspace_id uuid NOT NULL,
  memory_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  mention varchar(300),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT memory_entities_pk PRIMARY KEY (memory_id, entity_id),
  CONSTRAINT memory_entities_memory_workspace_fk FOREIGN KEY (memory_id, workspace_id) REFERENCES memories(id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT memory_entities_entity_workspace_fk FOREIGN KEY (entity_id, workspace_id) REFERENCES entities(id, workspace_id) ON DELETE CASCADE
);
CREATE INDEX memory_entities_workspace_entity_idx ON memory_entities(workspace_id, entity_id);

CREATE TABLE entity_relations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  from_entity_id uuid NOT NULL,
  to_entity_id uuid NOT NULL,
  type relation_type NOT NULL,
  label varchar(160),
  properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  valid_from timestamptz,
  valid_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT entity_relations_from_workspace_fk FOREIGN KEY (from_entity_id, workspace_id) REFERENCES entities(id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT entity_relations_to_workspace_fk FOREIGN KEY (to_entity_id, workspace_id) REFERENCES entities(id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT entity_relations_distinct_entities CHECK (from_entity_id <> to_entity_id),
  CONSTRAINT entity_relations_validity_range CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until >= valid_from)
);
CREATE INDEX entity_relations_workspace_from_idx ON entity_relations(workspace_id, from_entity_id);
CREATE INDEX entity_relations_workspace_to_idx ON entity_relations(workspace_id, to_entity_id);

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action varchar(120) NOT NULL,
  resource_type varchar(80) NOT NULL,
  resource_id uuid,
  outcome varchar(24) NOT NULL DEFAULT 'success',
  ip_address varchar(64),
  user_agent varchar(500),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_workspace_created_idx ON audit_logs(workspace_id, created_at);
CREATE INDEX audit_logs_workspace_resource_idx ON audit_logs(workspace_id, resource_type, resource_id);
