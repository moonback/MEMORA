import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { Client } from "pg";

const adminUrl = process.env.DATABASE_URL;
const appUrl = process.env.DATABASE_APP_URL;
const suite = describe("MEM-014 PostgreSQL row-level tenant isolation", { skip: !adminUrl || !appUrl }, () => {
  const admin = new Client({ connectionString: adminUrl });
  const suffix = randomUUID();
  const authUserA = randomUUID();
  const authUserB = randomUUID();
  let userA: string;
  let userB: string;
  let workspaceA: string;
  let workspaceB: string;

  before(async () => {
    await admin.connect();
    const a = await admin.query(
      "INSERT INTO users (email, auth_user_id) VALUES ($1, $2) RETURNING id",
      [`rls-a-${suffix}@example.invalid`, authUserA],
    );
    const b = await admin.query(
      "INSERT INTO users (email, auth_user_id) VALUES ($1, $2) RETURNING id",
      [`rls-b-${suffix}@example.invalid`, authUserB],
    );
    userA = a.rows[0].id;
    userB = b.rows[0].id;
    const wa = await admin.query(
      "INSERT INTO workspaces (name, slug, owner_user_id) VALUES ('Tenant A', $1, $2) RETURNING id",
      [`rls-a-${suffix}`, userA],
    );
    const wb = await admin.query(
      "INSERT INTO workspaces (name, slug, owner_user_id) VALUES ('Tenant B', $1, $2) RETURNING id",
      [`rls-b-${suffix}`, userB],
    );
    workspaceA = wa.rows[0].id;
    workspaceB = wb.rows[0].id;
    await admin.query(
      "INSERT INTO workspace_members (workspace_id, user_id, role, status, joined_at) VALUES ($1, $2, 'owner', 'active', now()), ($3, $4, 'owner', 'active', now())",
      [workspaceA, userA, workspaceB, userB],
    );
    await admin.query(
      "INSERT INTO sources (workspace_id, created_by_user_id, type, title) VALUES ($1, $2, 'manual', 'Private A'), ($3, $4, 'manual', 'Private B')",
      [workspaceA, userA, workspaceB, userB],
    );
  });

  after(async () => {
    if (workspaceA) await admin.query("DELETE FROM workspaces WHERE id = $1", [workspaceA]);
    if (workspaceB) await admin.query("DELETE FROM workspaces WHERE id = $1", [workspaceB]);
    if (userA) await admin.query("DELETE FROM users WHERE id = $1", [userA]);
    if (userB) await admin.query("DELETE FROM users WHERE id = $1", [userB]);
    await admin.end();
  });

  it("hides every other workspace and its sources from the restricted application role", async () => {
    const app = new Client({ connectionString: appUrl });
    await app.connect();
    try {
      await app.query("BEGIN");
      await app.query("SELECT set_config('app.auth_user_id', $1, true)", [authUserA]);
      await app.query("SELECT set_config('app.user_id', $1, true)", [userA]);
      await app.query("SELECT set_config('app.user_email', $1, true)", [`rls-a-${suffix}@example.invalid`]);
      await app.query("SELECT set_config('app.workspace_id', $1, true)", [workspaceA]);

      const workspaces = await app.query("SELECT id FROM workspaces ORDER BY id");
      assert.deepEqual(workspaces.rows.map((row) => row.id), [workspaceA]);

      const sources = await app.query("SELECT title FROM sources ORDER BY title");
      assert.deepEqual(sources.rows.map((row) => row.title), ["Private A"]);

      const members = await app.query("SELECT user_id FROM workspace_members");
      assert.deepEqual(members.rows.map((row) => row.user_id), [userA]);

      const crossTenantInsert = await app.query(
        "INSERT INTO sources (workspace_id, created_by_user_id, type, title) VALUES ($1, $2, 'manual', 'forbidden')",
        [workspaceB, userA],
      ).then(() => null, (error: { code?: string }) => error);
      assert.equal(crossTenantInsert?.code, "42501");

      const crossTenantMembership = await app.query(
        "INSERT INTO workspace_members (workspace_id, user_id, role, status) VALUES ($1, $2, 'member', 'active')",
        [workspaceB, userA],
      ).then(() => null, (error: { code?: string }) => error);
      assert.equal(crossTenantMembership?.code, "42501");
      await app.query("ROLLBACK");
    } finally {
      await app.end();
    }
  });

  it("does not expose domain rows when the transaction has no tenant context", async () => {
    const app = new Client({ connectionString: appUrl });
    await app.connect();
    try {
      const sources = await app.query("SELECT id FROM sources");
      assert.equal(sources.rowCount, 0);
      const workspaces = await app.query("SELECT id FROM workspaces");
      assert.equal(workspaces.rowCount, 0);
    } finally {
      await app.end();
    }
  });
});

void suite;
