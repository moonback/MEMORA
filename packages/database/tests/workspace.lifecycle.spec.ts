import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Client } from "pg";

const databaseUrl = process.env.DATABASE_URL;
describe("personal workspace lifecycle migration", { skip: !databaseUrl }, () => {
  const client = new Client({ connectionString: databaseUrl });
  before(async () => client.connect());
  after(async () => client.end());

  it("adds workspace description, metadata and archive timestamp", async () => {
    const result = await client.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'workspaces'",
    );
    const columns = new Set(result.rows.map((row) => row.column_name));
    assert.ok(columns.has("description"));
    assert.ok(columns.has("metadata"));
    assert.ok(columns.has("archived_at"));
  });

  it("enforces at most one personal workspace per owner", async () => {
    const result = await client.query<{ indexdef: string }>(
      "SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'workspaces_one_personal_per_owner_unique'",
    );
    assert.equal(result.rows.length, 1);
    assert.match(result.rows[0]?.indexdef ?? "", /WHERE \(type = 'personal'::workspace_type\)/);
  });
});
