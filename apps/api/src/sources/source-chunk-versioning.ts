import type { PoolClient } from "pg";

export interface ChunkVersionInput {
  ordinal: number;
  content: string;
  tokenCount?: number | null | undefined;
  pageNumber?: number | null | undefined;
  timeStartMs?: number | null | undefined;
  timeEndMs?: number | null | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface ChunkVersionResult {
  kept: number;
  inserted: number;
  retired: number;
}

const INCOMING = `unnest($3::int[], $4::text[], $5::int[], $6::int[], $7::int[], $8::int[], $9::jsonb[])
  AS i(ordinal, content, token_count, page_number, time_start_ms, time_end_ms, metadata)`;

/**
 * Replace the current chunk set of one source without destroying history (MEM-025).
 * Must run inside the caller's transaction with tenant context set.
 *
 * - A current chunk identical to an incoming one (same ordinal and every stored field equal,
 *   jsonb compared by value) keeps its ID.
 * - Any other current chunk is retired (is_current = false), never deleted: evidence rows
 *   reference chunks ON DELETE CASCADE and a check-then-delete would race with evidence inserts.
 * - Incoming chunks without an identical current one get new IDs.
 * The source row is locked FOR UPDATE so concurrent replacements of one source serialize.
 */
export async function replaceCurrentChunks(
  client: PoolClient,
  workspaceId: string,
  sourceId: string,
  chunks: readonly ChunkVersionInput[],
): Promise<ChunkVersionResult> {
  if (new Set(chunks.map((chunk) => chunk.ordinal)).size !== chunks.length) throw new Error("duplicate_chunk_ordinal");
  const locked = await client.query(
    "SELECT 1 FROM sources WHERE id = $1 AND workspace_id = $2 FOR UPDATE",
    [sourceId, workspaceId],
  );
  if (!locked.rowCount) throw new Error("source_not_found");

  const params = [
    workspaceId,
    sourceId,
    chunks.map((chunk) => chunk.ordinal),
    chunks.map((chunk) => chunk.content),
    chunks.map((chunk) => chunk.tokenCount ?? null),
    chunks.map((chunk) => chunk.pageNumber ?? null),
    chunks.map((chunk) => chunk.timeStartMs ?? null),
    chunks.map((chunk) => chunk.timeEndMs ?? null),
    chunks.map((chunk) => JSON.stringify(chunk.metadata ?? {})),
  ];

  // Retire before inserting so the partial unique index on current ordinals never collides.
  const retired = await client.query(
    `UPDATE source_chunks c SET is_current = false, updated_at = now()
     WHERE c.workspace_id = $1 AND c.source_id = $2 AND c.is_current
       AND NOT EXISTS (
         SELECT 1 FROM ${INCOMING}
         WHERE i.ordinal = c.ordinal AND i.content = c.content
           AND i.token_count IS NOT DISTINCT FROM c.token_count
           AND i.page_number IS NOT DISTINCT FROM c.page_number
           AND i.time_start_ms IS NOT DISTINCT FROM c.time_start_ms
           AND i.time_end_ms IS NOT DISTINCT FROM c.time_end_ms
           AND i.metadata = c.metadata
       )`,
    params,
  );

  // Remaining current chunks are exactly the identical ones; insert everything else.
  const inserted = await client.query(
    `INSERT INTO source_chunks
       (workspace_id, source_id, ordinal, content, token_count, page_number, time_start_ms, time_end_ms, metadata)
     SELECT $1, $2, i.ordinal, i.content, i.token_count, i.page_number, i.time_start_ms, i.time_end_ms, i.metadata
     FROM ${INCOMING}
     WHERE NOT EXISTS (
       SELECT 1 FROM source_chunks c
       WHERE c.workspace_id = $1 AND c.source_id = $2 AND c.is_current AND c.ordinal = i.ordinal
     )
     ORDER BY i.ordinal`,
    params,
  );

  const insertedCount = inserted.rowCount ?? 0;
  return { kept: chunks.length - insertedCount, inserted: insertedCount, retired: retired.rowCount ?? 0 };
}
