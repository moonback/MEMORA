# Database Schema

Initial schema includes users and workspaces.

Planned domain tables:
- workspace_members and workspace_invitations
- consents
- sources and source_chunks
- memories and memory_evidence
- entities, memory_entities and relations
- audit_logs

All private domain records must be workspace-scoped. Add foreign-key and composite constraints that prevent cross-workspace references. Enable and test PostgreSQL RLS before exposing user data.
