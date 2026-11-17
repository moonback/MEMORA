import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Pool } from "pg";
import { S3ObjectStorageService } from "./object-storage.service.js";
import { replaceCurrentChunks } from "./source-chunk-versioning.js";
import { PermanentSourceIngestionError, type SourceIngestionContext } from "./source-ingestion-processor.js";
import { MAX_TEXT_OBJECT_BYTES, SourceTextExtractionProcessor } from "./source-text-extraction.processor.js";
import { chunkText, decodeAndNormalizeText } from "./source-text.js";

// Admin URL: fixtures only. App URL: restricted NOBYPASSRLS memora_app role used by the processor.
const adminUrl = process.env.MEMORA_EXTRACTION_TEST_DATABASE_URL;
const appUrl = process.env.MEMORA_EXTRACTION_TEST_APP_DATABASE_URL;

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const permanent = (code: string) => (error: unknown) =>
  error instanceof PermanentSourceIngestionError && error.code === code;

describe("MEM-025 real PostgreSQL text extraction processor", { skip: !adminUrl || !appUrl, timeout: 60_000 }, () => {
  const admin = new Pool({ connectionString: adminUrl, max: 3 });
  const app = new Pool({ connectionString: appUrl, max: 5 });
  const suffix = randomUUID();
  const objects = new Map<string, Buffer | "missing" | "interrupted">();
  const storage = new S3ObjectStorageService();
  const processor = new SourceTextExtractionProcessor(storage, app);
  let userId = "";
  let workspaceA = "";
  let workspaceB = "";

  const createObjectSource = async (input: {
    bytes: Buffer;
    contentType?: string;
    originalName?: string;
    type?: string;
    workspaceId?: string;
    declaredSize?: number;
    verify?: boolean;
  }): Promise<SourceIngestionContext & { objectKey: string }> => {
    const workspaceId = input.workspaceId ?? workspaceA;
    const source = await admin.query<{ id: string }>(
      `INSERT INTO sources (workspace_id, created_by_user_id, type, status, title, original_name, mime_type)
       VALUES ($1, $2, $3, 'pending', 'MEM-025', $4, $5) RETURNING id`,
      [workspaceId, userId, input.type ?? "document", input.originalName ?? "notes.txt", input.contentType ?? "text/plain"],
    );
    const sourceId = source.rows[0]!.id;
    const objectKey = `${workspaceId}/${sourceId}/${randomUUID()}`;
    objects.set(objectKey, input.bytes);
    await admin.query(
      `INSERT INTO source_objects (workspace_id, source_id, storage_provider, bucket_name, object_key, status,
         content_type, byte_size, checksum_sha256, uploaded_at, expires_at)
       VALUES ($1, $2, 's3-compatible', 'memora-test', $3, 'pending', $4, $5, $6, now(), now() + interval '1 day')`,
      [workspaceId, sourceId, objectKey, input.contentType ?? "text/plain", input.declaredSize ?? input.bytes.length, sha256(input.bytes)],
    );
    if (input.verify === false) {
      // Inconsistent state on purpose: ready source whose object never got verified.
      await admin.query("UPDATE sources SET status = 'ready' WHERE id = $1", [sourceId]);
    } else {
      // Real MEM-024 triggers: verified object -> ready source -> queued ingestion.
      await admin.query("UPDATE source_objects SET status = 'verified', verified_at = now() WHERE source_id = $1", [sourceId]);
    }
    return { ...(await claim(sourceId, workspaceId)), objectKey };
  };

  // Simulates the worker claim (status processing) on the trigger-created ingestion.
  const claim = async (sourceId: string, workspaceId: string): Promise<SourceIngestionContext> => {
    const ingestion = await admin.query<{ id: string; attempts: number }>(
      `UPDATE source_ingestions SET status = 'processing', attempts = attempts + 1, lease_token = gen_random_uuid(),
         lease_until = now() + interval '5 minutes'
       WHERE source_id = $1 RETURNING id, attempts`,
      [sourceId],
    );
    assert.equal(ingestion.rowCount, 1, "MEM-024 trigger must create one ingestion");
    return { ingestionId: ingestion.rows[0]!.id, sourceId, workspaceId, attempt: ingestion.rows[0]!.attempts };
  };

  const replaceObject = async (context: { sourceId: string; objectKey: string }, bytes: Buffer) => {
    objects.set(context.objectKey, bytes);
    await admin.query("UPDATE source_objects SET byte_size = $2, checksum_sha256 = $3 WHERE source_id = $1", [context.sourceId, bytes.length, sha256(bytes)]);
  };

  const chunks = async (sourceId: string) =>
    (await admin.query<{ id: string; ordinal: number; content: string; is_current: boolean }>(
      "SELECT id, ordinal, content, is_current FROM source_chunks WHERE source_id = $1 ORDER BY is_current DESC, ordinal, created_at",
      [sourceId],
    )).rows;

  before(async () => {
    const role = await app.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user",
    );
    assert.deepEqual(role.rows[0], { rolsuper: false, rolbypassrls: false }, "processor pool must not bypass RLS");

    const client = new S3Client({ region: "eu-west-1" });
    client.send = (async (command: unknown) => {
      assert.ok(command instanceof GetObjectCommand);
      const stored = objects.get(command.input.Key ?? "");
      if (!stored || stored === "missing") throw Object.assign(new Error("not found"), { name: "NoSuchKey" });
      if (stored === "interrupted") {
        return {
          Body: new Readable({ read() { this.push(Buffer.from("partial")); this.destroy(new Error("socket hang up")); } }),
        };
      }
      return { Body: Readable.from([stored.subarray(0, 3), stored.subarray(3)]), ContentLength: stored.length };
    }) as typeof client.send;
    storage.configureClientForTests(client, {
      endpoint: "https://s3.eu-west-1.example.invalid", region: "eu-west-1",
      accessKeyId: "test", secretAccessKey: "test", bucket: "memora-test", provider: "s3-compatible",
    });

    const user = await admin.query<{ id: string }>(
      "INSERT INTO users (email, auth_user_id) VALUES ($1, $2) RETURNING id",
      [`mem025-${suffix}@example.invalid`, randomUUID()],
    );
    userId = user.rows[0]!.id;
    const workspaces = await admin.query<{ id: string }>(
      "INSERT INTO workspaces (name, slug, owner_user_id, type) VALUES ('MEM-025 A', $1, $3, 'shared'), ('MEM-025 B', $2, $3, 'shared') RETURNING id",
      [`mem025-a-${suffix}`, `mem025-b-${suffix}`, userId],
    );
    workspaceA = workspaces.rows[0]!.id;
    workspaceB = workspaces.rows[1]!.id;
  });

  after(async () => {
    await app.end();
    await admin.end();
  });

  it("extracts, normalizes and chunks a verified TXT object under RLS", async () => {
    const context = await createObjectSource({ bytes: Buffer.from("﻿Premier paragraphe.\r\n\r\n\r\nSecond paragraphe.\r\n") });
    const result = await processor.extract(context);
    assert.deepEqual(result, { kept: 0, inserted: 1, retired: 0 });
    const rows = await chunks(context.sourceId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.content, "Premier paragraphe.\n\nSecond paragraphe.");
    assert.equal(rows[0]!.ordinal, 0);
    assert.equal(rows[0]!.is_current, true);
  });

  it("extracts Markdown and is idempotent on re-extraction", async () => {
    const markdown = Buffer.from(`# Titre\n\n${"a ".repeat(1500)}\n\n## Suite\n\nFin.`);
    const context = await createObjectSource({ bytes: markdown, contentType: "text/markdown", originalName: "doc.md" });
    await processor.process(context);
    const first = await chunks(context.sourceId);
    assert.ok(first.length >= 2);
    assert.deepEqual(await processor.extract(context), { kept: first.length, inserted: 0, retired: 0 });
    assert.deepEqual(await chunks(context.sourceId), first);
  });

  it("keeps unchanged chunk IDs, versions changed ones and preserves historical evidence", async () => {
    const paragraph = (label: string) => `${label} ${"x".repeat(1800)}`;
    const context = await createObjectSource({ bytes: Buffer.from(`${paragraph("A")}\n\n${paragraph("B")}`) });
    await processor.extract(context);
    const before = await chunks(context.sourceId);
    assert.equal(before.length, 2);

    const memory = await admin.query<{ id: string }>(
      "INSERT INTO memories (workspace_id, created_by_user_id, type, content) VALUES ($1, $2, 'fact', 'B') RETURNING id",
      [workspaceA, userId],
    );
    await admin.query(
      "INSERT INTO memory_evidence (workspace_id, memory_id, source_chunk_id, quote) VALUES ($1, $2, $3, 'B')",
      [workspaceA, memory.rows[0]!.id, before[1]!.id],
    );

    await replaceObject(context, Buffer.from(`${paragraph("A")}\n\n${paragraph("B2")}`));
    assert.deepEqual(await processor.extract(context), { kept: 1, inserted: 1, retired: 1 });
    const afterRows = await chunks(context.sourceId);
    const current = afterRows.filter((row) => row.is_current);
    assert.equal(current.length, 2);
    assert.equal(current[0]!.id, before[0]!.id, "unchanged chunk keeps its ID");
    assert.notEqual(current[1]!.id, before[1]!.id, "changed content gets a new ID");
    assert.ok(current[1]!.content.startsWith("B2 "));

    // Evidence still resolves to the historical chunk and its original content.
    const evidence = await app.connect();
    try {
      await evidence.query("BEGIN");
      await evidence.query("SELECT set_config('app.workspace_id', $1, true)", [workspaceA]);
      const historical = await evidence.query<{ content: string; is_current: boolean }>(
        `SELECT c.content, c.is_current FROM memory_evidence e
         JOIN source_chunks c ON c.id = e.source_chunk_id AND c.workspace_id = e.workspace_id
         WHERE e.memory_id = $1`,
        [memory.rows[0]!.id],
      );
      assert.equal(historical.rowCount, 1);
      assert.equal(historical.rows[0]!.is_current, false);
      assert.ok(historical.rows[0]!.content.startsWith("B "));
      await evidence.query("COMMIT");
    } finally {
      evidence.release();
    }
  });

  it("rolls back the whole replacement when a write fails", async () => {
    const context = await createObjectSource({ bytes: Buffer.from("Stable content.") });
    await processor.extract(context);
    const before = await chunks(context.sourceId);
    const client = await app.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [workspaceA]);
      await assert.rejects(replaceCurrentChunks(client, workspaceA, context.sourceId, [{ ordinal: -1, content: "invalid" }]));
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
    assert.deepEqual(await chunks(context.sourceId), before);
  });

  it("versions API-provided chunks with exact content and full-field identity (PUT path)", async () => {
    const source = await admin.query<{ id: string }>(
      "INSERT INTO sources (workspace_id, created_by_user_id, type, title) VALUES ($1, $2, 'document', 'PUT') RETURNING id",
      [workspaceA, userId],
    );
    const sourceId = source.rows[0]!.id;
    const tricky = 'Quote " backslash \\ braces {a,b} comma, NULL\n\n```\ncode\t"x"\n```';
    const base = { ordinal: 0, content: tricky, tokenCount: 7, pageNumber: 2, timeStartMs: 10, timeEndMs: 20 };
    const put = async (chunk: Parameters<typeof replaceCurrentChunks>[3][number]) => {
      const client = await app.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT set_config('app.workspace_id', $1, true)", [workspaceA]);
        const result = await replaceCurrentChunks(client, workspaceA, sourceId, [chunk, { ordinal: 1, content: "NULL" }]);
        await client.query("COMMIT");
        return result;
      } finally {
        client.release();
      }
    };

    assert.deepEqual(await put({ ...base, metadata: { b: 1, a: 2 } }), { kept: 0, inserted: 2, retired: 0 });
    const first = await chunks(sourceId);
    assert.equal(first[0]!.content, tricky);
    assert.equal(first[1]!.content, "NULL");

    assert.deepEqual(await put({ ...base, metadata: { a: 2, b: 1 } }), { kept: 2, inserted: 0, retired: 0 });
    assert.deepEqual(await chunks(sourceId), first, "jsonb key order does not change identity");

    assert.deepEqual(await put({ ...base, tokenCount: 8, metadata: { a: 2, b: 1 } }), { kept: 1, inserted: 1, retired: 1 });
    const current = (await chunks(sourceId)).filter((row) => row.is_current);
    assert.notEqual(current[0]!.id, first[0]!.id);
    assert.equal(current[1]!.id, first[1]!.id);
  });

  it("serializes concurrent extractions without duplicate current chunks", async () => {
    const bytes = Buffer.from(`${"p ".repeat(1500)}\n\n${"q ".repeat(1500)}`);
    const expected = chunkText(decodeAndNormalizeText(bytes));
    const context = await createObjectSource({ bytes });
    await Promise.all([processor.extract(context), processor.extract(context), processor.extract(context)]);
    const rows = await chunks(context.sourceId);
    assert.deepEqual(rows.map((row) => [row.ordinal, row.content, row.is_current]), expected.map((content, ordinal) => [ordinal, content, true]));
  });

  it("enforces workspace isolation through RLS", async () => {
    const context = await createObjectSource({ bytes: Buffer.from("Secret A") });
    await assert.rejects(processor.extract({ ...context, workspaceId: workspaceB }), permanent("invalid_source_state"));
    assert.equal((await chunks(context.sourceId)).length, 0);

    await processor.extract(context);
    const client = await app.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [workspaceB]);
      const leaked = await client.query("SELECT 1 FROM source_chunks WHERE source_id = $1", [context.sourceId]);
      assert.equal(leaked.rowCount, 0);
      await assert.rejects(replaceCurrentChunks(client, workspaceA, context.sourceId, [{ ordinal: 0, content: "x" }]));
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("preserves manual sources without re-extraction or duplicates", async () => {
    const source = await admin.query<{ id: string }>(
      "INSERT INTO sources (workspace_id, created_by_user_id, type, status, title, mime_type) VALUES ($1, $2, 'manual', 'pending', 'Note', 'text/plain') RETURNING id",
      [workspaceA, userId],
    );
    const sourceId = source.rows[0]!.id;
    const chunk = await admin.query<{ id: string }>(
      "INSERT INTO source_chunks (workspace_id, source_id, ordinal, content) VALUES ($1, $2, 0, 'Note manuelle') RETURNING id",
      [workspaceA, sourceId],
    );
    await admin.query("UPDATE sources SET status = 'ready' WHERE id = $1", [sourceId]);
    const context = await claim(sourceId, workspaceA);
    assert.equal(await processor.extract(context), null);
    await processor.process(context);
    const rows = await chunks(sourceId);
    assert.deepEqual(rows.map((row) => [row.id, row.content, row.is_current]), [[chunk.rows[0]!.id, "Note manuelle", true]]);
  });

  it("refuses unclaimed ingestions and unverified objects", async () => {
    const context = await createObjectSource({ bytes: Buffer.from("Lease") });
    await admin.query("UPDATE source_ingestions SET status = 'queued' WHERE id = $1", [context.ingestionId]);
    await assert.rejects(processor.extract(context), permanent("invalid_source_state"));

    const unverified = await createObjectSource({ bytes: Buffer.from("Pending"), verify: false });
    await assert.rejects(processor.extract(unverified), permanent("invalid_source_state"));
    assert.equal((await chunks(unverified.sourceId)).length, 0);
  });

  it("maps storage integrity, absence and format failures to explicit errors", async () => {
    const corrupted = await createObjectSource({ bytes: Buffer.from("original") });
    objects.set(corrupted.objectKey, Buffer.from("tampered"));
    await assert.rejects(processor.extract(corrupted), permanent("object_integrity_failed"));

    const truncated = await createObjectSource({ bytes: Buffer.from("full content") });
    objects.set(truncated.objectKey, Buffer.from("full"));
    await assert.rejects(processor.extract(truncated), permanent("object_integrity_failed"));

    const missing = await createObjectSource({ bytes: Buffer.from("gone") });
    objects.set(missing.objectKey, "missing");
    await assert.rejects(processor.extract(missing), permanent("object_missing"));

    const interrupted = await createObjectSource({ bytes: Buffer.from("network") });
    objects.set(interrupted.objectKey, "interrupted");
    await assert.rejects(processor.extract(interrupted), (error: unknown) => error instanceof Error && !(error instanceof PermanentSourceIngestionError));

    const pdf = await createObjectSource({ bytes: Buffer.from("%PDF-1.7"), contentType: "application/pdf", originalName: "a.pdf" });
    await assert.rejects(processor.extract(pdf), permanent("unsupported_format"));

    const disguised = await createObjectSource({ bytes: Buffer.from("text"), contentType: "text/plain", originalName: "a.pdf" });
    await assert.rejects(processor.extract(disguised), permanent("unsupported_format"));

    const binary = await createObjectSource({ bytes: Buffer.from([0x89, 0x50, 0x00, 0x47]) });
    await assert.rejects(processor.extract(binary), permanent("unsupported_format"));

    const audio = await createObjectSource({ bytes: Buffer.from("x"), type: "audio" });
    await assert.rejects(processor.extract(audio), permanent("unsupported_source"));

    const large = await createObjectSource({ bytes: Buffer.from("x"), declaredSize: MAX_TEXT_OBJECT_BYTES + 1 });
    await assert.rejects(processor.extract(large), permanent("object_too_large"));

    for (const context of [corrupted, truncated, missing, interrupted, pdf, disguised, binary, audio, large]) {
      assert.equal((await chunks(context.sourceId)).length, 0);
    }
  });
});
