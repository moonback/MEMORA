import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { Client } from "pg";

const adminUrl = process.env.DATABASE_URL;
const appUrl = process.env.DATABASE_APP_URL;

describe("MEM-016 workspace-scoped memories and evidence", { skip: !adminUrl || !appUrl }, () => {
  const admin = new Client({ connectionString: adminUrl });
  const suffix = randomUUID();
  const authId = randomUUID();
  const otherAuthId = randomUUID();
  let userId: string;
  let otherUserId: string;
  let workspaceId: string;
  let otherWorkspaceId: string;
  let sourceId: string;
  let chunkId: string;
  let memoryId: string;

  before(async () => {
    await admin.connect();
    const user = await admin.query(
      "INSERT INTO users (email, auth_user_id) VALUES ($1, $2) RETURNING id",
      [`memory-owner-${suffix}@example.invalid`, authId],
    );
    userId = user.rows[0].id;
    const other = await admin.query(
      "INSERT INTO users (email, auth_user_id) VALUES ($1, $2) RETURNING id",
      [`memory-other-${suffix}@example.invalid`, otherAuthId],
    );
    otherUserId = other.rows[0].id;
    const workspace = await admin.query(
      "INSERT INTO workspaces (name, slug, owner_user_id) VALUES ('Memory workspace', $1, $2) RETURNING id",
      [`memory-${suffix}`, userId],
    );
    workspaceId = workspace.rows[0].id;
    const otherWorkspace = await admin.query(
      "INSERT INTO workspaces (name, slug, owner_user_id) VALUES ('Other memory workspace', $1, $2) RETURNING id",
      [`other-memory-${suffix}`, otherUserId],
    );
    otherWorkspaceId = otherWorkspace.rows[0].id;
    await admin.query(
      "INSERT INTO workspace_members (workspace_id, user_id, role, status, joined_at) VALUES ($1, $2, 'owner', 'active', now()), ($3, $4, 'owner', 'active', now())",
      [workspaceId, userId, otherWorkspaceId, otherUserId],
    );
    const source = await admin.query(
      "INSERT INTO sources (workspace_id, created_by_user_id, type, title) VALUES ($1, $2, 'note', 'Evidence source') RETURNING id",
      [workspaceId, userId],
    );
    sourceId = source.rows[0].id;
    const chunk = await admin.query(
      "INSERT INTO source_chunks (workspace_id, source_id, ordinal, content) VALUES ($1, $2, 0, 'The meeting is Tuesday') RETURNING id",
      [workspaceId, sourceId],
    );
    chunkId = chunk.rows[0].id;
    const memory = await admin.query(
      "INSERT INTO memories (workspace_id, created_by_user_id, type, content, confidence, valid_from) VALUES ($1, $2, 'fact', 'Meeting is Tuesday', 90, now()) RETURNING id",
      [workspaceId, userId],
    );
    memoryId = memory.rows[0].id;
    await admin.query(
      "INSERT INTO memory_evidence (workspace_id, memory_id, source_chunk_id, evidence_type, quote) VALUES ($1, $2, $3, 'supports', 'Tuesday')",
      [workspaceId, memoryId, chunkId],
    );
  });

  after(async () => {
    if (workspaceId) await admin.query("DELETE FROM workspaces WHERE id = $1", [workspaceId]);
    if (otherWorkspaceId) await admin.query("DELETE FROM workspaces WHERE id = $1", [otherWorkspaceId]);
    if (userId) await admin.query("DELETE FROM users WHERE id = $1", [userId]);
    if (otherUserId) await admin.query("DELETE FROM users WHERE id = $1", [otherUserId]);
    await admin.end();
  });

  it("keeps memories and evidence visible only inside the active workspace context", async () => {
    const app = new Client({ connectionString: appUrl });
    await app.connect();
    try {
      await app.query("BEGIN");
      await app.query("SELECT set_config('app.auth_user_id', $1, true)", [authId]);
      await app.query("SELECT set_config('app.user_id', $1, true)", [userId]);
      await app.query("SELECT set_config('app.workspace_id', $1, true)", [workspaceId]);
      const memories = await app.query("SELECT id, content FROM memories");
      assert.deepEqual(memories.rows, [{ id: memoryId, content: "Meeting is Tuesday" }]);
      const evidence = await app.query("SELECT memory_id, source_chunk_id FROM memory_evidence");
      assert.deepEqual(evidence.rows, [{ memory_id: memoryId, source_chunk_id: chunkId }]);
      const foreign = await app.query("SELECT id FROM memories WHERE workspace_id = $1", [otherWorkspaceId]);
      assert.equal(foreign.rowCount, 0);
      await app.query("ROLLBACK");
    } finally {
      await app.end();
    }
  });

  it("rejects evidence that combines a memory and source chunk from different workspaces", async () => {
    const app = new Client({ connectionString: appUrl });
    await app.connect();
    try {
      await app.query("BEGIN");
      await app.query("SELECT set_config('app.auth_user_id', $1, true)", [authId]);
      await app.query("SELECT set_config('app.user_id', $1, true)", [userId]);
      await app.query("SELECT set_config('app.workspace_id', $1, true)", [workspaceId]);
      const error = await app.query(
        "INSERT INTO memory_evidence (workspace_id, memory_id, source_chunk_id, evidence_type) VALUES ($1, $2, $3, 'supports')",
        [otherWorkspaceId, memoryId, chunkId],
      ).then(() => null, (caught: { code?: string }) => caught);
      assert.ok(error);
      assert.ok(["42501", "23503"].includes(error.code ?? ""));
      await app.query("ROLLBACK");
    } finally {
      await app.end();
    }
  });

  it("enforces the database confidence and validity constraints", async () => {
    const confidenceError = await admin.query(
      "INSERT INTO memories (workspace_id, created_by_user_id, type, content, confidence) VALUES ($1, $2, 'fact', 'Invalid confidence', 101)",
      [workspaceId, userId],
    ).then(() => null, (caught: { code?: string }) => caught);
    assert.equal(confidenceError?.code, "23514");
    const validityError = await admin.query(
      "INSERT INTO memories (workspace_id, created_by_user_id, type, content, valid_from, valid_until) VALUES ($1, $2, 'fact', 'Invalid validity', now(), now() - interval '1 day')",
      [workspaceId, userId],
    ).then(() => null, (caught: { code?: string }) => caught);
    assert.equal(validityError?.code, "23514");
  });
});
