import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { Client } from "pg";

const adminUrl = process.env.DATABASE_URL;
const appUrl = process.env.DATABASE_APP_URL;

describe("MEM-022 atomic manual capture persistence", { skip: !adminUrl || !appUrl }, () => {
  const admin = new Client({ connectionString: adminUrl });
  const suffix = randomUUID();
  const authId = randomUUID();
  let userId: string;
  let workspaceId: string;

  before(async () => {
    await admin.connect();
    const user = await admin.query(
      "INSERT INTO users (email, auth_user_id) VALUES ($1, $2) RETURNING id",
      [`mem022-${suffix}@example.invalid`, authId],
    );
    userId = user.rows[0].id;
    const workspace = await admin.query(
      "INSERT INTO workspaces (name, slug, owner_user_id) VALUES ('MEM-022 capture', $1, $2) RETURNING id",
      [`mem022-${suffix}`, userId],
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

  it("creates a ready manual source and its first provenance chunk in one transaction", async () => {
    const app = new Client({ connectionString: appUrl });
    await app.connect();
    let sourceId: string | undefined;
    try {
      await app.query("BEGIN");
      await app.query("SELECT set_config('app.auth_user_id', $1, true)", [authId]);
      await app.query("SELECT set_config('app.user_id', $1, true)", [userId]);
      await app.query("SELECT set_config('app.workspace_id', $1, true)", [workspaceId]);
      const source = await app.query(
        `INSERT INTO sources (workspace_id, created_by_user_id, type, status, title, mime_type)
         VALUES ($1, $2, 'manual', 'pending', 'Capture test', 'text/plain') RETURNING id`,
        [workspaceId, userId],
      );
      sourceId = source.rows[0].id;
      await app.query(
        "INSERT INTO source_chunks (workspace_id, source_id, ordinal, content) VALUES ($1, $2, 0, $3)",
        [workspaceId, sourceId, "Texte original de la note"],
      );
      await app.query("UPDATE sources SET status = 'ready', processed_at = now() WHERE id = $1", [sourceId]);
      await app.query("COMMIT");
    } catch (error) {
      await app.query("ROLLBACK");
      throw error;
    } finally {
      await app.end();
    }

    const persisted = await admin.query(
      `SELECT s.type, s.status, s.title, c.ordinal, c.content
       FROM sources s JOIN source_chunks c ON c.source_id = s.id AND c.workspace_id = s.workspace_id
       WHERE s.id = $1 AND s.workspace_id = $2`,
      [sourceId, workspaceId],
    );
    assert.deepEqual(persisted.rows, [{
      type: "manual", status: "ready", title: "Capture test", ordinal: 0, content: "Texte original de la note",
    }]);
  });

  it("rolls back the source when its first chunk cannot be inserted", async () => {
    const app = new Client({ connectionString: appUrl });
    await app.connect();
    let sourceId: string | undefined;
    try {
      await app.query("BEGIN");
      await app.query("SELECT set_config('app.auth_user_id', $1, true)", [authId]);
      await app.query("SELECT set_config('app.user_id', $1, true)", [userId]);
      await app.query("SELECT set_config('app.workspace_id', $1, true)", [workspaceId]);
      const source = await app.query(
        "INSERT INTO sources (workspace_id, created_by_user_id, type, title) VALUES ($1, $2, 'manual', 'Must rollback') RETURNING id",
        [workspaceId, userId],
      );
      sourceId = source.rows[0].id;
      await assert.rejects(
        app.query("INSERT INTO source_chunks (workspace_id, source_id, ordinal, content) VALUES ($1, $2, -1, 'invalid')", [workspaceId, sourceId]),
        (error: { code?: string }) => error.code === "23514",
      );
      await app.query("ROLLBACK");
    } finally {
      await app.end();
    }
    const persisted = await admin.query("SELECT id FROM sources WHERE id = $1", [sourceId]);
    assert.equal(persisted.rowCount, 0);
  });
});
