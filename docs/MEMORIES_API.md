# Memories and evidence API

MEM-016 adds authenticated, workspace-scoped memory management. Every route requires an active workspace membership. Creating/updating memories and evidence requires owner, admin or member; archive is restricted to owner/admin.

Base path: `/api/workspaces/:workspaceId/memories`.

- `GET /`: list memories, defaulting to active status; optional type, status, text query, limit (1–100) and offset.
- `POST /`: create a memory and optionally attach up to 50 source-chunk evidence records in the same transaction.
- `GET /:memoryId`: fetch a memory with its evidence and source provenance metadata.
- `PATCH /:memoryId`: update content, summary, confidence, event time, validity interval or attributes. Only active memories can be edited.
- `POST /:memoryId/evidence`: attach or update an evidence record.
- `DELETE /:memoryId/evidence/:evidenceId`: remove a single evidence link.
- `POST /:memoryId/supersede`: create a replacement memory and mark the previous record superseded, preserving the history and self-reference.
- `POST /:memoryId/archive`: archive an active memory.

Memory types: fact, preference, event, decision, commitment, note and observation. Statuses: active, superseded and archived. Confidence is an integer from 0 to 100. Evidence classifications are supports, contradicts and context.

The workspace identifier comes exclusively from the URL and authenticated membership context; request bodies cannot select another workspace. Evidence must reference a source chunk in the same workspace. PostgreSQL RLS and composite foreign keys provide independent isolation boundaries.

This milestone does not infer memories with AI or implement semantic/vector recall. Extraction, deduplication, entity linking and retrieval ranking are later milestones.
