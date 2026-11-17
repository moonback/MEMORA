import type { Pool, PoolClient } from "pg";
import type { S3ObjectStorageService } from "./object-storage.service.js";
import { replaceCurrentChunks, type ChunkVersionResult } from "./source-chunk-versioning.js";
import {
  PermanentSourceIngestionError,
  type SourceIngestionContext,
  type SourceIngestionProcessor,
} from "./source-ingestion-processor.js";
import { chunkText, decodeAndNormalizeText, detectTextFormat } from "./source-text.js";

/** Text objects above this size are refused before download (≈2 bytes per char once decoded). */
export const MAX_TEXT_OBJECT_BYTES = 10 * 1024 * 1024;

/** Source types whose verified object may be extracted as text. `manual` keeps its capture chunk. */
const TEXT_SOURCE_TYPES = new Set(["document", "note"]);

const INTEGRITY_ERRORS = new Set([
  "source_object_checksum_mismatch",
  "source_object_size_mismatch",
  "source_object_size_limit_exceeded",
  "source_object_invalid_stream_chunk",
]);

interface VerifiedObject {
  bucket_name: string;
  object_key: string;
  content_type: string;
  byte_size: string;
  checksum_sha256: string;
}

/**
 * MEM-025 processor. Uses a restricted (NOBYPASSRLS) pool and scopes every transaction with
 * transaction-local `app.workspace_id`, so RLS confines it to the job's workspace. The job
 * identifiers come from Redis and are re-anchored on a `processing` ingestion row before any read.
 */
export class SourceTextExtractionProcessor implements SourceIngestionProcessor {
  constructor(
    private readonly storage: Pick<S3ObjectStorageService, "readObject">,
    private readonly pool: Pool,
  ) {}

  async process(context: SourceIngestionContext): Promise<void> {
    await this.extract(context);
  }

  /** Returns null when the source content is preserved as is (manual capture / API-provided chunks). */
  async extract(context: SourceIngestionContext): Promise<ChunkVersionResult | null> {
    const target = await this.inWorkspace(context.workspaceId, async (client) => {
      await this.assertClaimed(client, context);
      const source = (await client.query<{ type: string; original_name: string | null; current_chunks: number }>(
        `SELECT s.type, s.original_name,
                (SELECT count(*)::int FROM source_chunks c
                 WHERE c.workspace_id = s.workspace_id AND c.source_id = s.id AND c.is_current) AS current_chunks
         FROM sources s WHERE s.id = $1 AND s.workspace_id = $2 AND s.status = 'ready'`,
        [context.sourceId, context.workspaceId],
      )).rows[0];
      if (!source) throw new PermanentSourceIngestionError("invalid_source_state");

      const object = (await client.query<VerifiedObject & { status: string }>(
        `SELECT bucket_name, object_key, status, content_type, byte_size, checksum_sha256
         FROM source_objects WHERE source_id = $1 AND workspace_id = $2`,
        [context.sourceId, context.workspaceId],
      )).rows[0];

      if (source.type === "manual" || !object) {
        // Content was captured as chunks (manual note or chunk API): keep it, never re-extract.
        if (source.current_chunks > 0) return null;
        throw new PermanentSourceIngestionError(source.type === "manual" ? "invalid_source_state" : "unsupported_source");
      }
      if (!TEXT_SOURCE_TYPES.has(source.type)) throw new PermanentSourceIngestionError("unsupported_source");
      if (object.status !== "verified" || !object.checksum_sha256 || !object.byte_size) {
        throw new PermanentSourceIngestionError("invalid_source_state");
      }
      detectTextFormat(object.content_type, source.original_name);
      if (Number(object.byte_size) > MAX_TEXT_OBJECT_BYTES) throw new PermanentSourceIngestionError("object_too_large");
      return object;
    });
    if (!target) return null;

    // Download outside any transaction; integrity is enforced by readObject.
    const bytes = await this.read(target);
    const chunks = chunkText(decodeAndNormalizeText(bytes)).map((content, ordinal) => ({ ordinal, content }));

    return this.inWorkspace(context.workspaceId, async (client) => {
      await this.assertClaimed(client, context);
      const still = await client.query<{ checksum_sha256: string }>(
        `SELECT o.checksum_sha256 FROM sources s
         JOIN source_objects o ON o.source_id = s.id AND o.workspace_id = s.workspace_id
         WHERE s.id = $1 AND s.workspace_id = $2 AND s.status = 'ready' AND o.status = 'verified'
         FOR UPDATE OF s`,
        [context.sourceId, context.workspaceId],
      );
      if (!still.rows[0]) throw new PermanentSourceIngestionError("invalid_source_state");
      // The object changed while downloading: retry from scratch (transient).
      if (still.rows[0].checksum_sha256.toLowerCase() !== target.checksum_sha256.toLowerCase()) {
        throw new Error("source_object_changed_during_extraction");
      }
      return replaceCurrentChunks(client, context.workspaceId, context.sourceId, chunks);
    });
  }

  private async read(object: VerifiedObject): Promise<Buffer> {
    try {
      return await this.storage.readObject({
        bucketName: object.bucket_name,
        objectKey: object.object_key,
        expectedByteSize: Number(object.byte_size),
        expectedChecksumSha256: object.checksum_sha256,
      });
    } catch (error) {
      if (error instanceof Error && INTEGRITY_ERRORS.has(error.message)) {
        throw new PermanentSourceIngestionError("object_integrity_failed");
      }
      if (error instanceof Error && error.name === "NoSuchKey") throw new PermanentSourceIngestionError("object_missing");
      throw error; // network / interrupted stream: transient, the worker requeues.
    }
  }

  private async assertClaimed(client: PoolClient, context: SourceIngestionContext): Promise<void> {
    const claimed = await client.query(
      `SELECT 1 FROM source_ingestions
       WHERE id = $1 AND source_id = $2 AND workspace_id = $3 AND status = 'processing'`,
      [context.ingestionId, context.sourceId, context.workspaceId],
    );
    if (!claimed.rowCount) throw new PermanentSourceIngestionError("invalid_source_state");
  }

  private async inWorkspace<T>(workspaceId: string, operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [workspaceId]);
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
