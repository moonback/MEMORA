import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { Client } from "pg";

const adminUrl = process.env.DATABASE_URL;
const appUrl = process.env.DATABASE_APP_URL;

describe("MEM-017 workspace-scoped entities and relation provenance", { skip: !adminUrl || !appUrl }, () => {
  const admin = new Client({ connectionString: adminUrl });
  const suffix = randomUUID();
  const authId = randomUUID();
  const otherAuthId = randomUUID();
  let userId: string;
  let otherUserId: string;
  let workspaceId: string;
  let otherWorkspaceId: string;
  let sourceChunkId: string;
  let otherChunkId: string;
  let fromEntityId: string;
  let toEntityId: string;
  let foreignEntityId: string;
  let relationId: string;

  before(async () => {
    await admin.connect();
    const users = await admin.query(
      "INSERT INTO users (email, auth_user_id) VALUES ($1, $2), ($3, $4) RETURNING id, email",
      [`entity-owner-${suffix}@example.invalid`, authId, `entity-other-${suffix}@example.invalid`, otherAuthId],
    );
    userId = users.rows.find((row) => row.email.startsWith("entity-owner-"))!.id;
    otherUserId = users.rows.find((row) => row.email.startsWith("entity-other-"))!.id;
    const workspaces = await admin.query(
      "INSERT INTO workspaces (name, slug, owner_user_id) VALUES ('Entity workspace', $1, $2), ('Other entity workspace', $3, $4) RETURNING id, slug",
      [`entity-${suffix}`, userId, `other-entity-${suffix}`, otherUserId],
    );
    workspaceId = workspaces.rows.find((row) => row.slug.startsWith("entity-"))!.id;
    otherWorkspaceId = workspaces.rows.find((row) => row.slug.startsWith("other-entity-"))!.id;

    const sources = await admin.query(
      "INSERT INTO sources (workspace_id, created_by_user_id, type, title) VALUES ($1, $2, 'note', 'Entity evidence'), ($3, $4, 'note', 'Foreign evidence') RETURNING id, workspace_id",
      [workspaceId, userId, otherWorkspaceId, otherUserId],
    );
    const sourceA = sources.rows.find((row) => row.workspace_id === workspaceId)!.id;
    const sourceB = sources.rows.find((row) => row.workspace_id === otherWorkspaceId)!.id;
    const chunks = await admin.query(
      "INSERT INTO source_chunks (workspace_id, source_id, ordinal, content) VALUES ($1, $2, 0, 'Alice works with Bob'), ($3, $4, 0, 'Foreign statement') RETURNING id, workspace_id",
      [workspaceId, sourceA, otherWorkspaceId, sourceB],
    );
    sourceChunkId = chunks.rows.find((row) => row.workspace_id === workspaceId)!.id;
    otherChunkId = chunks.rows.find((row) => row.workspace_id === otherWorkspaceId)!.id;

    const entities = await admin.query(
      "INSERT INTO entities (workspace_id, type, canonical_name) VALUES ($1, 'person', 'Alice'), ($1, 'person', 'Bob'), ($2, 'person', 'Foreign person') RETURNING id, canonical_name",
      [workspaceId, otherWorkspaceId],
    );
    fromEntityId = entities.rows.find((row) => row.canonical_name === "Alice")!.id;
    toEntityId = entities.rows.find((row) => row.canonical_name === "Bob")!.id;
    foreignEntityId = entities.rows.find((row) => row.canonical_name === "Foreign person")!.id;

    const relation = await admin.query(
      "INSERT INTO entity_relations (workspace_id, from_entity_id, to_entity_id, type, confidence) VALUES ($1, $2, $3, 'works_with', 90) RETURNING id",
      [workspaceId, fromEntityId, toEntityId],
    );
    relationId = relation.rows[0].id;
    await admin.query(
      "INSERT INTO entity_relation_evidence (workspace_id, relation_id, source_chunk_id, quote, confidence) VALUES ($1, $2, $3, 'Alice works with Bob', 95)",
      [workspaceId, relationId, sourceChunkId],
    );
  });

  after(async () => {
    if (workspaceId) await admin.query("DELETE FROM workspaces WHERE id = $1", [workspaceId]);
    if (otherWorkspaceId) await admin.query("DELETE FROM workspaces WHERE id = $1", [otherWorkspaceId]);
    if (userId) await admin.query("DELETE FROM users WHERE id = $1", [userId]);
    if (otherUserId) await admin.query("DELETE FROM users WHERE id = $1", [otherUserId]);
    await admin.end();
  });

  it("isolates entities, relations and relation evidence to the active workspace", async () => {
    const app = new Client({ connectionString: appUrl });
    await app.connect();
    try {
      await app.query("BEGIN");
      await app.query("SELECT set_config('app.auth_user_id', $1, true)", [authId]);
      await app.query("SELECT set_config('app.user_id', $1, true)", [userId]);
      await app.query("SELECT set_config('app.workspace_id', $1, true)", [workspaceId]);
      assert.equal((await app.query("SELECT id FROM entities")).rowCount, 2);
      assert.equal((await app.query("SELECT id FROM entity_relations")).rowCount, 1);
      const evidence = await app.query("SELECT relation_id, source_chunk_id, confidence FROM entity_relation_evidence");
      assert.deepEqual(evidence.rows, [{ relation_id: relationId, source_chunk_id: sourceChunkId, confidence: 95 }]);
      await app.query("ROLLBACK");
    } finally {
      await app.end();
    }
  });

  it("rejects relations and evidence that cross workspace boundaries", async () => {
    const relationError = await admin.query(
      "INSERT INTO entity_relations (workspace_id, from_entity_id, to_entity_id, type) VALUES ($1, $2, $3, 'related_to')",
      [workspaceId, fromEntityId, foreignEntityId],
    ).then(() => null, (error: { code?: string }) => error);
    assert.equal(relationError?.code, "23503");

    const evidenceError = await admin.query(
      "INSERT INTO entity_relation_evidence (workspace_id, relation_id, source_chunk_id) VALUES ($1, $2, $3)",
      [workspaceId, relationId, otherChunkId],
    ).then(() => null, (error: { code?: string }) => error);
    assert.equal(evidenceError?.code, "23503");
  });

  it("enforces relation confidence constraints", async () => {
    const error = await admin.query(
      "INSERT INTO entity_relations (workspace_id, from_entity_id, to_entity_id, type, confidence) VALUES ($1, $2, $3, 'related_to', 101)",
      [workspaceId, fromEntityId, toEntityId],
    ).then(() => null, (caught: { code?: string }) => caught);
    assert.equal(error?.code, "23514");
  });
});
