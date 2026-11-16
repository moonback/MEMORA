import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { ensurePersonalWorkspace } from "./personal-workspace.service.js";

const databaseUrl = process.env.DATABASE_URL;
const pool = new Pool({ connectionString: databaseUrl });

describe("ensurePersonalWorkspace", { skip: !databaseUrl }, () => {
  after(async () => pool.end());

  it("creates one personal workspace and owner membership idempotently", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const createdUser = await client.query<{ id: string }>(
        "INSERT INTO users (email, display_name) VALUES ($1, $2) RETURNING id",
        [`workspace-${randomUUID()}@test.invalid`, "Workspace test"],
      );
      const user = createdUser.rows[0];
      assert.ok(user);

      const first = await ensurePersonalWorkspace(client, user.id);
      const second = await ensurePersonalWorkspace(client, user.id);
      assert.equal(first.id, second.id);
      assert.equal(first.type, "personal");

      const counts = await client.query<{ workspace_count: string; owner_membership_count: string }>(
        `SELECT
           (SELECT count(*)::text FROM workspaces WHERE owner_user_id = $1 AND type = 'personal') AS workspace_count,
           (SELECT count(*)::text FROM workspace_members WHERE workspace_id = $2 AND user_id = $1 AND role = 'owner' AND status = 'active') AS owner_membership_count`,
        [user.id, first.id],
      );
      assert.equal(counts.rows[0]?.workspace_count, "1");
      assert.equal(counts.rows[0]?.owner_membership_count, "1");
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});
