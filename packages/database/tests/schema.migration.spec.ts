import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { Client } from "pg";

const databaseUrl = process.env.DATABASE_URL;
const suite = describe("MEMORA initial database migration", { skip: !databaseUrl }, () => {
  const client = new Client({ connectionString: databaseUrl });
  const suffix = randomUUID();
  let userId: string;
  let workspaceA: string;
  let workspaceB: string;
  let sourceId: string;

  before(async () => {
    await client.connect();
    const user = await client.query(
      "INSERT INTO users (email) VALUES ($1) RETURNING id",
      [`schema-test-${suffix}@example.invalid`],
    );
    userId = user.rows[0].id;

    const first = await client.query(
      "INSERT INTO workspaces (name, slug, owner_user_id) VALUES ($1, $2, $3) RETURNING id",
      ["Schema test A", `schema-test-a-${suffix}`, userId],
    );
    workspaceA = first.rows[0].id;
    const second = await client.query(
      "INSERT INTO workspaces (name, slug, owner_user_id) VALUES ($1, $2, $3) RETURNING id",
      ["Schema test B", `schema-test-b-${suffix}`, userId],
    );
    workspaceB = second.rows[0].id;

    const source = await client.query(
      "INSERT INTO sources (workspace_id, created_by_user_id, type, title) VALUES ($1, $2, 'manual', 'tenant boundary test') RETURNING id",
      [workspaceA, userId],
    );
    sourceId = source.rows[0].id;
  });

  after(async () => {
    if (workspaceA) await client.query("DELETE FROM workspaces WHERE id = $1", [workspaceA]);
    if (workspaceB) await client.query("DELETE FROM workspaces WHERE id = $1", [workspaceB]);
    if (userId) await client.query("DELETE FROM users WHERE id = $1", [userId]);
    await client.end();
  });

  it("creates all core domain tables", async () => {
    const result = await client.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
    );
    const names = new Set(result.rows.map((row) => row.table_name));
    for (const name of [
      "users", "workspaces", "workspace_members", "workspace_invitations",
      "consents", "sources", "source_chunks", "memories", "memory_evidence",
      "entities", "memory_entities", "entity_relations", "audit_logs",
      "_memora_migrations",
    ]) {
      assert.ok(names.has(name), `Expected table ${name} to exist`);
    }
  });

  it("rejects a source chunk that mixes source and workspace identifiers", async () => {
    await assert.rejects(
      client.query(
        "INSERT INTO source_chunks (workspace_id, source_id, ordinal, content) VALUES ($1, $2, 0, 'cross-workspace attempt')",
        [workspaceB, sourceId],
      ),
      (error: { code?: string }) => error.code === "23503",
    );
  });

  it("records the initial migration exactly once", async () => {
    const result = await client.query(
      "SELECT count(*)::int AS count FROM public._memora_migrations WHERE name = '0001_memora_core.sql'",
    );
    assert.equal(result.rows[0].count, 1);
  });
});

void suite;
