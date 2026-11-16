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

## Storage boundary

This milestone stores metadata, checksums and extracted text chunks. It does not yet accept binary uploads, issue presigned URLs, or persist object bytes. The `storage_key` remains server-managed and cannot be supplied by a client. EU object storage and upload scanning belong to the ingestion/storage milestone.

## Isolation and provenance

Every query runs inside `withWorkspaceContext`; the workspace is resolved from the authenticated session and verified membership, never trusted from a body field. PostgreSQL RLS and the composite `(source_id, workspace_id)` foreign key independently constrain chunk visibility and ownership. Source rows preserve creator, capture timestamp, checksum and metadata; chunk rows preserve ordinal, page/time offsets and per-chunk metadata.
