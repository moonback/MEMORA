import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { Client } from "pg";

const adminUrl = process.env.DATABASE_URL;
const appUrl = process.env.DATABASE_APP_URL;

describe("MEM-018 append-only workspace audit log", { skip: !adminUrl || !appUrl }, () => {
  const admin = new Client({ connectionString: adminUrl });
  const suffix = randomUUID();
  const authA = randomUUID();
  const authB = randomUUID();
  let userA: string;
  let userB: string;
  let workspaceA: string;
  let workspaceB: string;
  let sourceA: string;

  before(async () => {
    await admin.connect();
    const users = await admin.query(
      "INSERT INTO users (email, auth_user_id) VALUES ($1, $2), ($3, $4) RETURNING id, email",
      [`audit-a-${suffix}@example.invalid`, authA, `audit-b-${suffix}@example.invalid`, authB],
    );
    userA = users.rows.find((row) => row.email.startsWith("audit-a-"))!.id;
    userB = users.rows.find((row) => row.email.startsWith("audit-b-"))!.id;
    const workspaces = await admin.query(
      "INSERT INTO workspaces (name, slug, owner_user_id) VALUES ('Audit A', $1, $2), ('Audit B', $3, $4) RETURNING id, slug",
      [`audit-a-${suffix}`, userA, `audit-b-${suffix}`, userB],
    );
    workspaceA = workspaces.rows.find((row) => row.slug.startsWith("audit-a-"))!.id;
    workspaceB = workspaces.rows.find((row) => row.slug.startsWith("audit-b-"))!.id;
    const source = await admin.query(
      "INSERT INTO sources (workspace_id, created_by_user_id, type, title) VALUES ($1, $2, 'note', 'Private title') RETURNING id",
      [workspaceA, userA],
    );
    sourceA = source.rows[0].id;
  });

  after(async () => {
    if (workspaceA) await admin.query("DELETE FROM workspaces WHERE id = $1", [workspaceA]);
    if (workspaceB) await admin.query("DELETE FROM workspaces WHERE id = $1", [workspaceB]);
    if (userA) await admin.query("DELETE FROM users WHERE id = $1", [userA]);
    if (userB) await admin.query("DELETE FROM users WHERE id = $1", [userB]);
    await admin.end();
  });

  it("records mutations atomically without copying private field values", async () => {
    const app = new Client({ connectionString: appUrl });
    await app.connect();
    try {
      await app.query("BEGIN");
      await app.query("SELECT set_config('app.auth_user_id', $1, true)", [authA]);
      await app.query("SELECT set_config('app.user_id', $1, true)", [userA]);
      await app.query("SELECT set_config('app.workspace_id', $1, true)", [workspaceA]);
      await app.query("UPDATE sources SET status = 'ready', title = 'Sensitive changed title' WHERE id = $1", [sourceA]);
      const events = await app.query(
        "SELECT action, resource_type, resource_id, actor_user_id, metadata FROM audit_logs WHERE resource_id = $1",
        [sourceA],
      );
      assert.equal(events.rowCount, 2);
      const updateEvent = events.rows.find((row) => row.action === "sources.update");
      assert.ok(updateEvent);
      assert.equal(updateEvent.actor_user_id, userA);
      assert.deepEqual(updateEvent.metadata, {
        table: "sources",
        operation: "update",
        changed_fields: ["status"],
      });
      assert.equal(JSON.stringify(events.rows).includes("Sensitive changed title"), false);
      await app.query("ROLLBACK");
    } finally {
      await app.end();
    }
  });

  it("isolates audit reads to the active workspace", async () => {
    const app = new Client({ connectionString: appUrl });
    await app.connect();
    try {
      await app.query("BEGIN");
      await app.query("SELECT set_config('app.auth_user_id', $1, true)", [authA]);
      await app.query("SELECT set_config('app.user_id', $1, true)", [userA]);
      await app.query("SELECT set_config('app.workspace_id', $1, true)", [workspaceA]);
      const visible = await app.query("SELECT workspace_id FROM audit_logs");
      assert.ok(visible.rows.every((row) => row.workspace_id === workspaceA));
      assert.equal((await app.query("SELECT id FROM audit_logs WHERE workspace_id = $1", [workspaceB])).rowCount, 0);
      await app.query("ROLLBACK");
    } finally {
      await app.end();
    }
  });

  it("rejects actor spoofing and direct audit updates/deletes", async () => {
    const app = new Client({ connectionString: appUrl });
    await app.connect();
    try {
      await app.query("BEGIN");
      await app.query("SELECT set_config('app.auth_user_id', $1, true)", [authA]);
      await app.query("SELECT set_config('app.user_id', $1, true)", [userA]);
      await app.query("SELECT set_config('app.workspace_id', $1, true)", [workspaceA]);

      await app.query("SAVEPOINT before_actor_spoof");
      const spoof = await app.query(
        "INSERT INTO audit_logs (workspace_id, actor_user_id, action, resource_type) VALUES ($1, $2, 'spoof', 'test')",
        [workspaceA, userB],
      ).then(() => null, (error: { code?: string }) => error);
      assert.equal(spoof?.code, "42501");
      await app.query("ROLLBACK TO SAVEPOINT before_actor_spoof");

      const event = await app.query("SELECT id FROM audit_logs WHERE resource_id = $1 LIMIT 1", [sourceA]);
      assert.ok(event.rows[0]);
      const updated = await app.query("UPDATE audit_logs SET action = 'tampered' WHERE id = $1", [event.rows[0].id]);
      assert.equal(updated.rowCount, 0);
      const deleted = await app.query("DELETE FROM audit_logs WHERE id = $1", [event.rows[0].id]);
      assert.equal(deleted.rowCount, 0);
      await app.query("ROLLBACK");
    } finally {
      await app.end();
    }
  });
});
