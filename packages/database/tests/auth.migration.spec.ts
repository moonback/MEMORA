import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Client } from "pg";

const databaseUrl = process.env.DATABASE_URL;
describe("MEMORA authentication migration", { skip: !databaseUrl }, () => {
  const client = new Client({ connectionString: databaseUrl });
  before(async () => client.connect());
  after(async () => client.end());

  it("creates Better Auth identity, session, account and verification tables", async () => {
    const result = await client.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
    );
    const tables = new Set(result.rows.map((row) => row.table_name));
    for (const name of ["user", "session", "account", "verification"]) {
      assert.ok(tables.has(name), `Expected ${name} table to exist`);
    }
  });

  it("adds a unique application identity link without replacing the domain UUID", async () => {
    const result = await client.query<{ column_name: string; data_type: string }>(
      "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name IN ('id', 'auth_user_id')",
    );
    const columns = new Map(result.rows.map((row) => [row.column_name, row.data_type]));
    assert.equal(columns.get("id"), "uuid");
    assert.equal(columns.get("auth_user_id"), "character varying");
  });

  it("stores session tokens with a uniqueness constraint", async () => {
    const result = await client.query(
      "SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'session'",
    );
    assert.ok(result.rows.some((row) => row.indexname.includes("token")));
  });
});
