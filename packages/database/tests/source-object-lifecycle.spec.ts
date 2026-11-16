import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { Client } from "pg";

const adminUrl = process.env.DATABASE_URL;
const appUrl = process.env.DATABASE_APP_URL;

describe("MEM-021 PostgreSQL object upload lifecycle", { skip: !adminUrl || !appUrl }, () => {
  const admin = new Client({ connectionString: adminUrl });
  const suffix = randomUUID();
  const authId = randomUUID();
  const otherAuthId = randomUUID();
  let userId: string;
  let otherUserId: string;
  let workspaceId: string;
  let otherWorkspaceId: string;
  let sourceId: string;
  let objectId: string;
  let foreignObjectId: string;

  before(async () => {
    await admin.connect();
    const user = await admin.query("INSERT INTO users (email, auth_user_id) VALUES ($1, $2) RETURNING id", [`mem021-${suffix}@example.invalid`, authId]);
    userId = user.rows[0].id;
    const other = await admin.query("INSERT INTO users (email, auth_user_id) VALUES ($1, $2) RETURNING id", [`mem021-other-${suffix}@example.invalid`, otherAuthId]);
    otherUserId = other.rows[0].id;
    const workspace = await admin.query("INSERT INTO workspaces (name, slug, owner_user_id) VALUES ('MEM-021', $1, $2) RETURNING id", [`mem021-${suffix}`, userId]);
    workspaceId = workspace.rows[0].id;
    const otherWorkspace = await admin.query("INSERT INTO workspaces (name, slug, owner_user_id) VALUES ('MEM-021 other', $1, $2) RETURNING id", [`mem021-other-${suffix}`, otherUserId]);
    otherWorkspaceId = otherWorkspace.rows[0].id;
    await admin.query("INSERT INTO workspace_members (workspace_id, user_id, role, status, joined_at) VALUES ($1, $2, 'owner', 'active', now()), ($3, $4, 'owner', 'active', now())", [workspaceId, userId, otherWorkspaceId, otherUserId]);
    const source = await admin.query("INSERT INTO sources (workspace_id, created_by_user_id, type, title) VALUES ($1, $2, 'document', 'Lifecycle test') RETURNING id", [workspaceId, userId]);
    sourceId = source.rows[0].id;
    const object = await admin.query(
      `INSERT INTO source_objects (workspace_id, source_id, storage_provider, bucket_name, object_key, content_type, byte_size, checksum_sha256, expires_at)
       VALUES ($1, $2, 's3-compatible', 'memora-test', $3, 'application/pdf', 10, $4, now() - interval '1 minute') RETURNING id`,
      [workspaceId, sourceId, `objects/${suffix}`, "a".repeat(64)],
    );
    objectId = object.rows[0].id;
    const foreignSource = await admin.query("INSERT INTO sources (workspace_id, created_by_user_id, type, title) VALUES ($1, $2, 'document', 'Foreign lifecycle test') RETURNING id", [otherWorkspaceId, otherUserId]);
    const foreign = await admin.query(
      `INSERT INTO source_objects (workspace_id, source_id, storage_provider, bucket_name, object_key, content_type, byte_size, checksum_sha256, expires_at)
       VALUES ($1, $2, 's3-compatible', 'memora-test', $3, 'application/pdf', 10, $4, now() - interval '1 minute') RETURNING id`,
      [otherWorkspaceId, foreignSource.rows[0].id, `foreign/${suffix}`, "b".repeat(64)],
    );
    foreignObjectId = foreign.rows[0].id;
  });

  after(async () => {
    if (workspaceId) await admin.query("DELETE FROM workspaces WHERE id = $1", [workspaceId]);
    if (otherWorkspaceId) await admin.query("DELETE FROM workspaces WHERE id = $1", [otherWorkspaceId]);
    if (userId) await admin.query("DELETE FROM users WHERE id = $1", [userId]);
    if (otherUserId) await admin.query("DELETE FROM users WHERE id = $1", [otherUserId]);
    await admin.end();
  });

  it("persists expiry and refuses verification after the deadline", async () => {
    const result = await admin.query("SELECT expires_at, status FROM source_objects WHERE id = $1", [objectId]);
    assert.equal(result.rows[0].status, "pending");
    assert.ok(new Date(result.rows[0].expires_at).getTime() < Date.now());
    await assert.rejects(admin.query(
      "UPDATE source_objects SET status = 'verified', uploaded_at = now(), verified_at = expires_at - interval '1 second' WHERE id = $1",
      [objectId],
    ), (error: { code?: string }) => error.code === "23514");
  });

  it("isolates lifecycle rows under the restricted application role", async () => {
    const app = new Client({ connectionString: appUrl });
    await app.connect();
    try {
      await app.query("BEGIN");
      await app.query("SELECT set_config('app.auth_user_id', $1, true)", [authId]);
      await app.query("SELECT set_config('app.user_id', $1, true)", [userId]);
      await app.query("SELECT set_config('app.workspace_id', $1, true)", [workspaceId]);
      const visible = await app.query("SELECT id FROM source_objects ORDER BY id");
      assert.deepEqual(visible.rows.map((row) => row.id), [objectId]);
      assert.ok(!visible.rows.some((row) => row.id === foreignObjectId));
      await app.query("ROLLBACK");
    } finally { await app.end(); }
  });

  it("allows retry lease release and blocks verified-to-deleted transitions", async () => {
    const lease = randomUUID();
    await admin.query(
      "UPDATE source_objects SET cleanup_lease_token = $2, cleanup_lease_until = now() - interval '1 second', cleanup_attempts = cleanup_attempts + 1, cleanup_last_error = 'storage_delete_failed' WHERE id = $1",
      [objectId, lease],
    );
    const retryable = await admin.query(
      "UPDATE source_objects SET cleanup_lease_token = NULL, cleanup_lease_until = NULL WHERE id = $1 AND cleanup_lease_token = $2 RETURNING id",
      [objectId, lease],
    );
    assert.equal(retryable.rowCount, 1);

    const verifiedSource = await admin.query("INSERT INTO sources (workspace_id, created_by_user_id, type, title) VALUES ($1, $2, 'document', 'Verified immutability') RETURNING id", [workspaceId, userId]);
    const verified = await admin.query(
      `INSERT INTO source_objects (workspace_id, source_id, storage_provider, bucket_name, object_key, status, content_type, byte_size, checksum_sha256, uploaded_at, verified_at, expires_at)
       VALUES ($1, $2, 's3-compatible', 'memora-test', $3, 'verified', 'application/pdf', 10, $4, now(), now(), now() + interval '1 hour') RETURNING id`,
      [workspaceId, verifiedSource.rows[0].id, `verified/${suffix}`, "c".repeat(64)],
    );
    await assert.rejects(admin.query("UPDATE source_objects SET status = 'deleted' WHERE id = $1", [verified.rows[0].id]),
      (error: { code?: string }) => error.code === "23514");
  });
});
