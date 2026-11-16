# Manual capture

MEM-022 introduces a first-party note capture path. It is intentionally separate from binary upload and future ingestion workers.

## API

Authenticated route:

`POST /api/workspaces/:workspaceId/capture/notes`

Request:

```json
{
  "title": "Idée à retenir",
  "content": "Texte original de la note",
  "capturedAt": "2026-11-16T12:00:00.000Z"
}
```

`capturedAt` is optional; the server uses the current time when omitted. Unknown properties are rejected. Title is limited to 500 characters and note content to 20,000 characters.

The endpoint is available to active owners, admins and members. Viewers retain read access through the source endpoints but cannot create notes.

## Persistence and provenance

The API inserts a `manual` source, its ordinal-zero `source_chunks` row, then changes the source status to `ready` inside one `withWorkspaceContext` transaction. A failure at any point rolls back the complete capture. The chunk retains the original note text as the evidence from which future memories can be derived.

All reads and writes are workspace-scoped and protected by PostgreSQL RLS. The client cannot choose the workspace owner, creator identity, source type, source status or storage coordinates.

## Web

Open **Mes espaces**, select an active workspace, then choose **Bibliothèque de sources**. The library currently supports creating and reading manual notes and lists source metadata. Binary import, OCR, transcription, extraction and semantic search are separate roadmap items.

## Privacy

Note text is not written to application logs. Captured content is stored as a source chunk and remains subject to the workspace's existing access controls and retention lifecycle.
