import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { ObjectUploadCleanupService } from "./object-upload-cleanup.service.js";
import { S3ObjectStorageService } from "./object-storage.service.js";

const systemUrl = process.env.DATABASE_SYSTEM_URL ?? process.env.DATABASE_URL;
const suite = describe("MEM-021 PostgreSQL cleanup worker with mocked S3", { skip: !systemUrl }, () => {
  const pool = new Pool({ connectionString: systemUrl, max: 3 });
  const suffix = randomUUID();
  let userId: string;
  let workspaceId: string;
  let sourceId: string;
  let verifiedSourceId: string;
  let pendingId: string;
  let verifiedId: string;

  before(async () => {
    const user = await pool.query("INSERT INTO users (email, auth_user_id) VALUES ($1, $2) RETURNING id", [`mem021-cleanup-${suffix}@example.invalid`, randomUUID()]);
    userId = user.rows[0].id;
    const workspace = await pool.query("INSERT INTO workspaces (name, slug, owner_user_id) VALUES ('Cleanup integration', $1, $2) RETURNING id", [`mem021-cleanup-${suffix}`, userId]);
    workspaceId = workspace.rows[0].id;
    await pool.query("INSERT INTO workspace_members (workspace_id, user_id, role, status, joined_at) VALUES ($1, $2, 'owner', 'active', now())", [workspaceId, userId]);
    const source = await pool.query("INSERT INTO sources (workspace_id, created_by_user_id, type, title) VALUES ($1, $2, 'document', 'Expired cleanup') RETURNING id", [workspaceId, userId]);
    sourceId = source.rows[0].id;
    const pending = await pool.query(
      `INSERT INTO source_objects (workspace_id, source_id, storage_provider, bucket_name, object_key, content_type, byte_size, checksum_sha256, expires_at)
       VALUES ($1, $2, 's3-compatible', 'memora-test', $3, 'application/pdf', 12, $4, now() - interval '2 minutes') RETURNING id`,
      [workspaceId, sourceId, `cleanup/${suffix}`, "d".repeat(64)],
    );
    pendingId = pending.rows[0].id;

    const verifiedSource = await pool.query("INSERT INTO sources (workspace_id, created_by_user_id, type, title) VALUES ($1, $2, 'document', 'Verified keep') RETURNING id", [workspaceId, userId]);
    verifiedSourceId = verifiedSource.rows[0].id;
    const verified = await pool.query(
      `INSERT INTO source_objects (workspace_id, source_id, storage_provider, bucket_name, object_key, status, content_type, byte_size, checksum_sha256, uploaded_at, verified_at, expires_at)
       VALUES ($1, $2, 's3-compatible', 'memora-test', $3, 'verified', 'application/pdf', 12, $4, now(), now(), now() + interval '1 hour') RETURNING id`,
      [workspaceId, verifiedSourceId, `verified/${suffix}`, "e".repeat(64)],
    );
    verifiedId = verified.rows[0].id;
  });

  after(async () => {
    if (workspaceId) await pool.query("DELETE FROM workspaces WHERE id = $1", [workspaceId]);
    if (userId) await pool.query("DELETE FROM users WHERE id = $1", [userId]);
    await pool.end();
  });

  it("retries transient S3 delete failures and never sends verified objects to DeleteObject", async () => {
    const storage = new S3ObjectStorageService();
    const client = new S3Client({
      endpoint: "https://s3.eu-west-1.example.invalid", region: "eu-west-1",
      credentials: { accessKeyId: "test-access-key", secretAccessKey: "test-secret-key" },
    });
    let deleteCalls = 0;
    const deletedKeys: string[] = [];
    client.send = (async (command: unknown) => {
      assert.ok(command instanceof DeleteObjectCommand);
      deleteCalls += 1;
      if (deleteCalls === 1) throw new Error("provider outage with private diagnostic");
      deletedKeys.push((command as DeleteObjectCommand).input.Key ?? "");
      return {};
    }) as typeof client.send;
    storage.configureClientForTests(client, {
      endpoint: "https://s3.eu-west-1.example.invalid", region: "eu-west-1",
      accessKeyId: "test-access-key", secretAccessKey: "test-secret-key",
      bucket: "memora-test", provider: "s3-compatible",
    });
    const worker = new ObjectUploadCleanupService(storage);
    worker.configurePoolForTests(pool);

    assert.equal(await worker.runCleanupBatch(), 0);
    const failed = await pool.query("SELECT status, cleanup_attempts, cleanup_last_error, cleanup_lease_token FROM source_objects WHERE id = $1", [pendingId]);
    assert.equal(failed.rows[0].status, "pending");
    assert.equal(failed.rows[0].cleanup_attempts, 1);
    assert.equal(failed.rows[0].cleanup_last_error, "storage_delete_failed");
    assert.equal(failed.rows[0].cleanup_lease_token, null);

    assert.equal(await worker.runCleanupBatch(), 1);
    const completed = await pool.query("SELECT status, cleanup_attempts FROM source_objects WHERE id = $1", [pendingId]);
    assert.equal(completed.rows[0].status, "deleted");
    assert.equal(completed.rows[0].cleanup_attempts, 1);
    assert.equal(deleteCalls, 2);
    assert.equal(deletedKeys.length, 1);

    const protectedObject = await pool.query("SELECT status FROM source_objects WHERE id = $1", [verifiedId]);
    assert.equal(protectedObject.rows[0].status, "verified");
    assert.ok(verifiedSourceId);
    await worker.onModuleDestroy();
  });
});

void suite;
