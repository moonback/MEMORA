# Sources and source chunks

MEM-015 exposes workspace-scoped source metadata and normalized chunk management. All endpoints require an authenticated session and an active workspace membership; source creation and chunk replacement require owner, admin or member, while archiving is restricted to owner/admin.

## API

Base path: `/api/workspaces/:workspaceId/sources`.

- `GET /`: list sources with optional `type`, `status`, `limit` (1–100) and `offset`.
- `POST /`: create source metadata. New sources begin in `pending`.
- `GET /:sourceId`: fetch metadata and chunk count.
- `GET /:sourceId/chunks`: list normalized chunks in ordinal order.
- `PUT /:sourceId/chunks`: atomically replace the source's chunk set and mark it `ready`.
- `POST /:sourceId/archive`: soft-archive the source; chunk provenance is retained.

Supported source types: document, email, audio, note, image, manual and web_clip. SHA-256 checksums must be 64 hexadecimal characters. Chunk ordinals are unique within a source; content is limited to 20,000 characters per chunk, and the replacement request is limited to 100 chunks.

## Manual note capture

- `POST /api/workspaces/:workspaceId/capture/notes`: atomically creates a `manual` source, ordinal-zero source chunk and `ready` status. Requires owner/admin/member. Body is strict: title (1–500 chars), content (1–20,000 chars), optional ISO datetime `capturedAt`. The transaction rolls back the source if its chunk cannot be persisted. See [MANUAL_CAPTURE.md](MANUAL_CAPTURE.md).

## Storage boundary

The source metadata API still does not accept binary bytes or expose presigned URLs. MEM-019 adds a separate `source_objects` record for private object coordinates and verified upload metadata. Object keys are generated server-side and are never accepted from client payloads. A concrete storage adapter, signed upload flow and malware scanning are not yet enabled; see `OBJECT_STORAGE.md`.

## Isolation and provenance

Every query runs inside `withWorkspaceContext`; the workspace is resolved from the authenticated session and verified membership, never trusted from a body field. PostgreSQL RLS and the composite `(source_id, workspace_id)` foreign key independently constrain chunk visibility and ownership. Source rows preserve creator, capture timestamp, checksum and metadata; chunk rows preserve ordinal, page/time offsets and per-chunk metadata.
