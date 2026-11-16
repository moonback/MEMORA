import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { Client } from "pg";

const adminUrl = process.env.DATABASE_URL;
const appUrl = process.env.DATABASE_APP_URL;

describe("MEM-015 workspace-scoped sources and chunks", { skip: !adminUrl || !appUrl }, () => {
  const admin = new Client({ connectionString: adminUrl });
  const suffix = randomUUID();
  const authId = randomUUID();
  const otherAuthId = randomUUID();
  let userId: string;
  let otherUserId: string;
  let workspaceId: string;
  let otherWorkspaceId: string;
  let sourceId: string;

  before(async () => {
    await admin.connect();
    const user = await admin.query(
      "INSERT INTO users (email, auth_user_id) VALUES ($1, $2) RETURNING id",
      [`source-owner-${suffix}@example.invalid`, authId],
    );
    userId = user.rows[0].id;
    const other = await admin.query(
      "INSERT INTO users (email, auth_user_id) VALUES ($1, $2) RETURNING id",
      [`source-other-${suffix}@example.invalid`, otherAuthId],
    );
    otherUserId = other.rows[0].id;
    const workspace = await admin.query(
      "INSERT INTO workspaces (name, slug, owner_user_id) VALUES ('Source workspace', $1, $2) RETURNING id",
      [`source-${suffix}`, userId],
    );
    workspaceId = workspace.rows[0].id;
    const otherWorkspace = await admin.query(
      "INSERT INTO workspaces (name, slug, owner_user_id) VALUES ('Other workspace', $1, $2) RETURNING id",
      [`other-source-${suffix}`, otherUserId],
    );
    otherWorkspaceId = otherWorkspace.rows[0].id;
    await admin.query(
      "INSERT INTO workspace_members (workspace_id, user_id, role, status, joined_at) VALUES ($1, $2, 'owner', 'active', now()), ($3, $4, 'owner', 'active', now())",
      [workspaceId, userId, otherWorkspaceId, otherUserId],
    );
    const source = await admin.query(
      "INSERT INTO sources (workspace_id, created_by_user_id, type, title, checksum_sha256) VALUES ($1, $2, 'document', 'Private source', $3) RETURNING id",
      [workspaceId, userId, "a".repeat(64)],
    );
    sourceId = source.rows[0].id;
    await admin.query(
      "INSERT INTO source_chunks (workspace_id, source_id, ordinal, content, page_number) VALUES ($1, $2, 0, 'Private extracted text', 1)",
      [workspaceId, sourceId],
    );
  });

  after(async () => {
    if (workspaceId) await admin.query("DELETE FROM workspaces WHERE id = $1", [workspaceId]);
    if (otherWorkspaceId) await admin.query("DELETE FROM workspaces WHERE id = $1", [otherWorkspaceId]);
    if (userId) await admin.query("DELETE FROM users WHERE id = $1", [userId]);
    if (otherUserId) await admin.query("DELETE FROM users WHERE id = $1", [otherUserId]);
    await admin.end();
  });

  it("returns only the current workspace source and its chunks", async () => {
    const app = new Client({ connectionString: appUrl });
    await app.connect();
    try {
      await app.query("BEGIN");
      await app.query("SELECT set_config('app.auth_user_id', $1, true)", [authId]);
      await app.query("SELECT set_config('app.user_id', $1, true)", [userId]);
      await app.query("SELECT set_config('app.workspace_id', $1, true)", [workspaceId]);
      const visible = await app.query("SELECT id, title FROM sources");
      assert.deepEqual(visible.rows, [{ id: sourceId, title: "Private source" }]);
      const chunks = await app.query("SELECT content FROM source_chunks WHERE source_id = $1", [sourceId]);
      assert.deepEqual(chunks.rows, [{ content: "Private extracted text" }]);
      const foreign = await app.query("SELECT id FROM sources WHERE workspace_id = $1", [otherWorkspaceId]);
      assert.equal(foreign.rowCount, 0);
      await app.query("ROLLBACK");
    } finally {
      await app.end();
    }
  });

  it("isolates private source object coordinates to the active workspace", async () => {
    const app = new Client({ connectionString: appUrl });
    await app.connect();
    try {
      await app.query("BEGIN");
      await app.query("SELECT set_config('app.auth_user_id', $1, true)", [authId]);
      await app.query("SELECT set_config('app.user_id', $1, true)", [userId]);
      await app.query("SELECT set_config('app.workspace_id', $1, true)", [workspaceId]);
      const inserted = await app.query(
        `INSERT INTO source_objects
          (workspace_id, source_id, storage_provider, bucket_name, object_key, content_type)
         VALUES ($1, $2, 's3-compatible', 'memora-private-test', $3, 'application/pdf')
         RETURNING id, status`,
        [workspaceId, sourceId, `objects/${suffix}/source.pdf`],
      );
      assert.equal(inserted.rows[0].status, "pending");
      const visible = await app.query("SELECT object_key FROM source_objects WHERE source_id = $1", [sourceId]);
      assert.deepEqual(visible.rows, [{ object_key: `objects/${suffix}/source.pdf` }]);
      await app.query("SELECT set_config('app.workspace_id', $1, true)", [otherWorkspaceId]);
      const hidden = await app.query("SELECT id FROM source_objects");
      assert.equal(hidden.rowCount, 0);
      await app.query("ROLLBACK");
    } finally {
      await app.end();
    }
  });

  it("rejects invalid object states, oversized objects and unverified completion", async () => {
    await assert.rejects(
      admin.query(
        `INSERT INTO source_objects
          (workspace_id, source_id, storage_provider, bucket_name, object_key, status, content_type)
         VALUES ($1, $2, 's3-compatible', 'memora-private-test', $3, 'public', 'application/pdf')`,
        [workspaceId, sourceId, `invalid/${suffix}`],
      ),
      (error: { code?: string }) => error.code === "23514",
    );
    await assert.rejects(
      admin.query(
        `INSERT INTO source_objects
          (workspace_id, source_id, storage_provider, bucket_name, object_key, status, content_type, byte_size)
         VALUES ($1, $2, 's3-compatible', 'memora-private-test', $3, 'verified', 'application/pdf', 104857601)`,
        [workspaceId, sourceId, `oversize/${suffix}`],
      ),
      (error: { code?: string }) => error.code === "23514",
    );
  });

  it("rejects chunk rows whose workspace does not match the parent source", async () => {
    const app = new Client({ connectionString: appUrl });
    await app.connect();
    try {
      await app.query("BEGIN");
      await app.query("SELECT set_config('app.auth_user_id', $1, true)", [authId]);
      await app.query("SELECT set_config('app.user_id', $1, true)", [userId]);
      await app.query("SELECT set_config('app.workspace_id', $1, true)", [workspaceId]);
      const error = await app.query(
        "INSERT INTO source_chunks (workspace_id, source_id, ordinal, content) VALUES ($1, $2, 1, 'forbidden')",
        [otherWorkspaceId, sourceId],
      ).then(() => null, (caught: { code?: string }) => caught);
      assert.ok(error);
      assert.ok(["42501", "23503"].includes(error.code ?? ""));
      await app.query("ROLLBACK");
    } finally {
      await app.end();
    }
  });
});
