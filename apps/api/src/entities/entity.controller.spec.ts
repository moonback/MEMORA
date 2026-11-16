import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createEntitySchema,
  updateEntitySchema,
  listEntitiesQuerySchema,
  linkMemorySchema,
  createEntityRelationSchema,
} from "./entity.controller.js";

const uuidA = "2b8fca9e-6d9e-4ec3-a5a8-77e9e14bb0ad";
const uuidB = "8e8b11d2-7cc1-4a87-b82d-8c9b28ab2b0e";

describe("entity and knowledge relation contracts", () => {
  it("accepts typed entities with aliases and attributes", () => {
    const parsed = createEntitySchema.parse({
      type: "person",
      canonicalName: "Alice Martin",
      aliases: ["Alice", "A. Martin"],
      attributes: { role: "colleague" },
    });
    assert.equal(parsed.type, "person");
    assert.equal(parsed.aliases.length, 2);
  });

  it("rejects duplicate aliases, blank names and unknown fields", () => {
    assert.equal(createEntitySchema.safeParse({ type: "person", canonicalName: " ", aliases: [] }).success, false);
    assert.equal(createEntitySchema.safeParse({ type: "person", canonicalName: "Alice", aliases: ["Alice", "alice"] }).success, false);
    assert.equal(createEntitySchema.safeParse({ type: "person", canonicalName: "Alice", workspaceId: uuidA }).success, false);
  });

  it("validates entity updates and search pagination", () => {
    assert.equal(updateEntitySchema.safeParse({}).success, false);
    assert.equal(updateEntitySchema.safeParse({ aliases: ["A", "a"] }).success, false);
    assert.deepEqual(listEntitiesQuerySchema.parse({}), { limit: 50, offset: 0 });
    assert.equal(listEntitiesQuerySchema.safeParse({ limit: "101" }).success, false);
  });

  it("requires a UUID for memory links", () => {
    assert.equal(linkMemorySchema.safeParse({ memoryId: uuidA }).success, true);
    assert.equal(linkMemorySchema.safeParse({ memoryId: "bad" }).success, false);
  });

  it("validates typed temporal relations and evidence provenance", () => {
    const parsed = createEntityRelationSchema.parse({
      toEntityId: uuidB,
      type: "works_with",
      confidence: 90,
      validFrom: "2026-01-01T00:00:00.000Z",
      evidence: [{ sourceChunkId: uuidA, quote: "Alice works with Bob", confidence: 95 }],
    });
    assert.equal(parsed.evidence.length, 1);
    assert.equal(createEntityRelationSchema.safeParse({
      toEntityId: uuidB,
      type: "works_with",
      confidence: 101,
    }).success, false);
    assert.equal(createEntityRelationSchema.safeParse({
      toEntityId: uuidB,
      type: "works_with",
      validFrom: "2026-12-01T00:00:00.000Z",
      validUntil: "2026-01-01T00:00:00.000Z",
    }).success, false);
    assert.equal(createEntityRelationSchema.safeParse({
      toEntityId: uuidB,
      type: "works_with",
      evidence: [{ sourceChunkId: uuidA }, { sourceChunkId: uuidA }],
    }).success, false);
  });
});
