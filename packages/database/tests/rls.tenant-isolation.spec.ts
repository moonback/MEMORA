import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";

const ownerUrl = process.env.DATABASE_URL;
const appUrl = process.env.DATABASE_APP_URL;
const ownerPool = new Pool({ connectionString: ownerUrl });
const appPool = new Pool({ connectionString: appUrl });

type Fixtures = {
  userA: string;
  authUserA: string;
  userB: string;
  workspaceA: string;
  workspaceB: string;
  sourceA: string;
  sourceB: string;
  memoryA: string;
  memoryB: string;
};

describe("PostgreSQL workspace RLS tenant isolation", { skip: !ownerUrl || !appUrl }, () => {
  let fixtures: Fixtures;

  before(async () => {
    const client = await ownerPool.connect();
    try {
      await client.query("BEGIN");
      const authUserA = `rls-auth-a-${randomUUID()}`;
      const authUserB = `rls-auth-b-${randomUUID()}`;
      const userAResult = await client.query<{ id: string }>(
        "INSERT INTO users (email, display_name, auth_user_id) VALUES ($1, $2, $3) RETURNING id",
        [`rls-a-${randomUUID()}@test.invalid`, "RLS user A", authUserA],
      );
      const userBResult = await client.query<{ id: string }>(
        "INSERT INTO users (email, display_name, auth_user_id) VALUES ($1, $2, $3) RETURNING id",
        [`rls-b-${randomUUID()}@test.invalid`, "RLS user B", authUserB],
      );
      const userA = userAResult.rows[0]?.id;
      const userB = userBResult.rows[0]?.id;
      assert.ok(userA && userB);

      const workspaceAResult = await client.query<{ id: string }>(
        "INSERT INTO workspaces (name, slug, type, owner_user_id) VALUES ('RLS A', $1, 'shared', $2) RETURNING id",
        [`rls-a-${randomUUID()}`, userA],
      );
      const workspaceBResult = await client.query<{ id: string }>(
        "INSERT INTO workspaces (name, slug, type, owner_user_id) VALUES ('RLS B', $1, 'shared', $2) RETURNING id",
        [`rls-b-${randomUUID()}`, userB],
      );
      const workspaceA = workspaceAResult.rows[0]?.id;
      const workspaceB = workspaceBResult.rows[0]?.id;
      assert.ok(workspaceA && workspaceB);

      await client.query(
        "INSERT INTO workspace_members (workspace_id, user_id, role, status) VALUES ($1, $2, 'owner', 'active'), ($3, $4, 'owner', 'active')",
        [workspaceA, userA, workspaceB, userB],
      );
      const sourceAResult = await client.query<{ id: string }>(
        "INSERT INTO sources (workspace_id, created_by_user_id, type, title) VALUES ($1, $2, 'manual', 'Private source A') RETURNING id",
        [workspaceA, userA],
      );
      const sourceBResult = await client.query<{ id: string }>(
        "INSERT INTO sources (workspace_id, created_by_user_id, type, title) VALUES ($1, $2, 'manual', 'Private source B') RETURNING id",
        [workspaceB, userB],
      );
      const memoryAResult = await client.query<{ id: string }>(
        "INSERT INTO memories (workspace_id, created_by_user_id, type, content) VALUES ($1, $2, 'fact', 'Private memory A') RETURNING id",
        [workspaceA, userA],
      );
      const memoryBResult = await client.query<{ id: string }>(
        "INSERT INTO memories (workspace_id, created_by_user_id, type, content) VALUES ($1, $2, 'fact', 'Private memory B') RETURNING id",
        [workspaceB, userB],
      );
      fixtures = {
        userA,
        authUserA,
        userB,
        workspaceA,
        workspaceB,
        sourceA: sourceAResult.rows[0]!.id,
        sourceB: sourceBResult.rows[0]!.id,
        memoryA: memoryAResult.rows[0]!.id,
        memoryB: memoryBResult.rows[0]!.id,
      };
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  after(async () => {
    if (fixtures) {
      await ownerPool.query("DELETE FROM workspaces WHERE id = ANY($1::uuid[])", [[fixtures.workspaceA, fixtures.workspaceB]]);
      await ownerPool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [[fixtures.userA, fixtures.userB]]);
    }
    await Promise.all([ownerPool.end(), appPool.end()]);
  });

  it("uses a non-owner role and blocks cross-workspace reads, writes, updates and deletes", async () => {
    const role = await appPool.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user",
    );
    assert.equal(role.rows[0]?.rolsuper, false);
    assert.equal(role.rows[0]?.rolbypassrls, false);

    const withoutContext = await appPool.query("SELECT id FROM sources WHERE id = $1", [fixtures.sourceA]);
    assert.equal(withoutContext.rowCount, 0);

    const client = await appPool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.auth_user_id', $1, true)", [fixtures.authUserA]);
      await client.query("SELECT set_config('app.current_user_id', $1, true)", [fixtures.userA]);
      await client.query("SELECT set_config('app.current_workspace_id', $1, true)", [fixtures.workspaceA]);
      await client.query("SELECT set_config('app.invitation_token_hash', '', true)");

      const visibleSources = await client.query("SELECT id FROM sources WHERE id = ANY($1::uuid[])", [[fixtures.sourceA, fixtures.sourceB]]);
      assert.deepEqual(visibleSources.rows.map((row) => row.id), [fixtures.sourceA]);
      const visibleMemories = await client.query("SELECT id FROM memories WHERE id = ANY($1::uuid[])", [[fixtures.memoryA, fixtures.memoryB]]);
      assert.deepEqual(visibleMemories.rows.map((row) => row.id), [fixtures.memoryA]);

      const visibleWorkspaceB = await client.query("SELECT id FROM workspaces WHERE id = $1", [fixtures.workspaceB]);
      assert.equal(visibleWorkspaceB.rowCount, 0);
      const visibleUserB = await client.query("SELECT id FROM users WHERE id = $1", [fixtures.userB]);
      assert.equal(visibleUserB.rowCount, 0);

      const updateSourceB = await client.query("UPDATE sources SET title = 'tampered' WHERE id = $1", [fixtures.sourceB]);
      assert.equal(updateSourceB.rowCount, 0);
      const deleteSourceB = await client.query("DELETE FROM sources WHERE id = $1", [fixtures.sourceB]);
      assert.equal(deleteSourceB.rowCount, 0);
      const updateMemoryB = await client.query("UPDATE memories SET content = 'tampered' WHERE id = $1", [fixtures.memoryB]);
      assert.equal(updateMemoryB.rowCount, 0);
      const deleteMemoryB = await client.query("DELETE FROM memories WHERE id = $1", [fixtures.memoryB]);
      assert.equal(deleteMemoryB.rowCount, 0);

      await assert.rejects(
        client.query(
          "INSERT INTO sources (workspace_id, created_by_user_id, type, title) VALUES ($1, $2, 'manual', 'cross-tenant')",
          [fixtures.workspaceB, fixtures.userA],
        ),
        /row-level security/i,
      );
      await assert.rejects(
        client.query(
          "INSERT INTO memories (workspace_id, created_by_user_id, type, content) VALUES ($1, $2, 'fact', 'cross-tenant')",
          [fixtures.workspaceB, fixtures.userA],
        ),
        /row-level security/i,
      );
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("allows workspace owners to write but keeps viewers read-only", async () => {
    const client = await appPool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.auth_user_id', $1, true)", [fixtures.authUserA]);
      await client.query("SELECT set_config('app.current_user_id', $1, true)", [fixtures.userA]);
      await client.query("SELECT set_config('app.current_workspace_id', $1, true)", [fixtures.workspaceA]);
      const inserted = await client.query(
        "INSERT INTO sources (workspace_id, created_by_user_id, type, title) VALUES ($1, $2, 'manual', 'owner write') RETURNING id",
        [fixtures.workspaceA, fixtures.userA],
      );
      assert.equal(inserted.rowCount, 1);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }

    await ownerPool.query(
      "UPDATE workspace_members SET role = 'viewer' WHERE workspace_id = $1 AND user_id = $2",
      [fixtures.workspaceA, fixtures.userA],
    );
    const viewer = await appPool.connect();
    try {
      await viewer.query("BEGIN");
      await viewer.query("SELECT set_config('app.auth_user_id', $1, true)", [fixtures.authUserA]);
      await viewer.query("SELECT set_config('app.current_user_id', $1, true)", [fixtures.userA]);
      await viewer.query("SELECT set_config('app.current_workspace_id', $1, true)", [fixtures.workspaceA]);
      const readable = await viewer.query("SELECT id FROM sources WHERE id = $1", [fixtures.sourceA]);
      assert.equal(readable.rowCount, 1);
      await assert.rejects(
        viewer.query(
          "INSERT INTO sources (workspace_id, created_by_user_id, type, title) VALUES ($1, $2, 'manual', 'viewer write')",
          [fixtures.workspaceA, fixtures.userA],
        ),
        /row-level security/i,
      );
      await viewer.query("ROLLBACK");
    } finally {
      viewer.release();
      await ownerPool.query(
        "UPDATE workspace_members SET role = 'owner' WHERE workspace_id = $1 AND user_id = $2",
        [fixtures.workspaceA, fixtures.userA],
      );
    }
  });
});
