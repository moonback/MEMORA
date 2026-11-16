import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { Client } from "pg";

const adminUrl = process.env.DATABASE_URL;
const appUrl = process.env.DATABASE_APP_URL;

describe("MEM-024 transactional source ingestion outbox", { skip: !adminUrl || !appUrl }, () => {
  const admin = new Client({ connectionString: adminUrl });
  const suffix = randomUUID();
  const authId = randomUUID();
  let userId: string;
  let workspaceId: string;

  before(async () => {
    await admin.connect();
    const user = await admin.query(
      "INSERT INTO users (email, auth_user_id) VALUES ($1, $2) RETURNING id",
      [`mem024-${suffix}@example.invalid`, authId],
    );
    userId = user.rows[0].id;
    const workspace = await admin.query(
      "INSERT INTO workspaces (name, slug, owner_user_id) VALUES ('MEM-024 ingestion', $1, $2) RETURNING id",
      [`mem024-${suffix}`, userId],
    );
    workspaceId = workspace.rows[0].id;
    await admin.query(
      "INSERT INTO workspace_members (workspace_id, user_id, role, status, joined_at) VALUES ($1, $2, 'owner', 'active', now())",
      [workspaceId, userId],
    );
  });

  after(async () => {
    if (workspaceId) await admin.query("DELETE FROM workspaces WHERE id = $1", [workspaceId]);
    if (userId) await admin.query("DELETE FROM users WHERE id = $1", [userId]);
    await admin.end();
  });

  it("creates exactly one minimal outbox event in the same transaction as manual source readiness", async () => {
    const source = await admin.query(
      "INSERT INTO sources (workspace_id, created_by_user_id, type, status, title) VALUES ($1, $2, 'manual', 'pending', 'Atomic note') RETURNING id",
      [workspaceId, userId],
    );
    const sourceId = source.rows[0].id;
    await admin.query("BEGIN");
    try {
      await admin.query("UPDATE sources SET status = 'ready', processed_at = now() WHERE id = $1", [sourceId]);
      const during = await admin.query(
        "SELECT i.status, o.event_type, o.payload FROM source_ingestions i JOIN source_ingestion_outbox o ON o.ingestion_id = i.id WHERE i.source_id = $1",
        [sourceId],
      );
      assert.deepEqual(during.rows, [{
        status: "queued",
        event_type: "source.ingestion.requested",
        payload: {},
      }]);
      await admin.query("ROLLBACK");
    } catch (error) {
      await admin.query("ROLLBACK");
      throw error;
    }
    const rolledBack = await admin.query("SELECT id FROM source_ingestions WHERE source_id = $1", [sourceId]);
    assert.equal(rolledBack.rowCount, 0);

    await admin.query("UPDATE sources SET status = 'ready', processed_at = now() WHERE id = $1", [sourceId]);
    const persisted = await admin.query(
      "SELECT i.status, i.attempts, o.payload, o.published_at FROM source_ingestions i JOIN source_ingestion_outbox o ON o.ingestion_id = i.id WHERE i.source_id = $1",
      [sourceId],
    );
    assert.deepEqual(persisted.rows, [{ status: "queued", attempts: 0, payload: {}, published_at: null }]);
    await admin.query("UPDATE sources SET status = 'processing' WHERE id = $1", [sourceId]);
    await admin.query("UPDATE sources SET status = 'ready' WHERE id = $1", [sourceId]);
    const duplicate = await admin.query("SELECT count(*)::int AS count FROM source_ingestions WHERE source_id = $1", [sourceId]);
    assert.equal(duplicate.rows[0].count, 1);
  });

  it("moves an uploaded source to ready and enqueues only after object verification", async () => {
    const source = await admin.query(
      "INSERT INTO sources (workspace_id, created_by_user_id, type, status, title) VALUES ($1, $2, 'document', 'pending', 'Uploaded document') RETURNING id",
      [workspaceId, userId],
    );
    const sourceId = source.rows[0].id;
    const object = await admin.query(
      `INSERT INTO source_objects
        (workspace_id, source_id, storage_provider, bucket_name, object_key, content_type,
         byte_size, checksum_sha256, expires_at)
       VALUES ($1, $2, 's3-compatible', 'memora-test', $3, 'application/pdf', 10, $4, now() + interval '1 hour')
       RETURNING id`,
      [workspaceId, sourceId, `mem024/${suffix}`, "d".repeat(64)],
    );
    const beforeVerify = await admin.query("SELECT status FROM sources WHERE id = $1", [sourceId]);
    assert.equal(beforeVerify.rows[0].status, "pending");
    await admin.query(
      `UPDATE source_objects SET status = 'verified', uploaded_at = now(), verified_at = now()
       WHERE id = $1`,
      [object.rows[0].id],
    );
    const result = await admin.query(
      "SELECT s.status AS source_status, i.status AS ingestion_status, count(o.id)::int AS outbox_count FROM sources s JOIN source_ingestions i ON i.source_id = s.id LEFT JOIN source_ingestion_outbox o ON o.ingestion_id = i.id WHERE s.id = $1 GROUP BY s.status, i.status",
      [sourceId],
    );
    assert.deepEqual(result.rows, [{ source_status: "ready", ingestion_status: "queued", outbox_count: 1 }]);
  });

  it("exposes ingestion state only inside the active workspace to the restricted role", async () => {
    const source = await admin.query(
      "INSERT INTO sources (workspace_id, created_by_user_id, type, status, title) VALUES ($1, $2, 'manual', 'pending', 'Tenant state') RETURNING id",
      [workspaceId, userId],
    );
    const sourceId = source.rows[0].id;
    await admin.query("UPDATE sources SET status = 'ready' WHERE id = $1", [sourceId]);

    // Seed a second tenant so this test proves cross-workspace isolation rather
    // than incorrectly assuming a workspace contains only this test's source.
    const foreignWorkspace = await admin.query(
      "INSERT INTO workspaces (name, slug, owner_user_id) VALUES ('MEM-024 foreign', $1, $2) RETURNING id",
      [`mem024-foreign-${suffix}`, userId],
    );
    const foreignSource = await admin.query(
      "INSERT INTO sources (workspace_id, created_by_user_id, type, status, title) VALUES ($1, $2, 'manual', 'pending', 'Foreign tenant state') RETURNING id",
      [foreignWorkspace.rows[0].id, userId],
    );
    await admin.query("UPDATE sources SET status = 'ready' WHERE id = $1", [foreignSource.rows[0].id]);

    const app = new Client({ connectionString: appUrl });
    await app.connect();
    try {
      await app.query("BEGIN");
      await app.query("SELECT set_config('app.auth_user_id', $1, true)", [authId]);
      await app.query("SELECT set_config('app.user_id', $1, true)", [userId]);
      await app.query("SELECT set_config('app.workspace_id', $1, true)", [workspaceId]);
      const visible = await app.query("SELECT source_id, status FROM source_ingestions");
      assert.ok(visible.rows.some((row) => row.source_id === sourceId && row.status === "queued"));
      assert.ok(visible.rows.every((row) => row.source_id !== foreignSource.rows[0].id));
      await app.query("ROLLBACK");
    } finally {
      await app.end();
      await admin.query("DELETE FROM workspaces WHERE id = $1", [foreignWorkspace.rows[0].id]);
    }
  });
});
