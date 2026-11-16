import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createMemoryRequestSchema,
  createMemoryEvidenceSchema,
  updateMemoryRequestSchema,
  listMemoriesQuerySchema,
  supersedeMemorySchema,
} from "./memory.controller.js";

const chunkId = "2b8fca9e-6d9e-4ec3-a5a8-77e9e14bb0ad";

describe("memory request contracts", () => {
  it("accepts a typed memory with temporal metadata and provenance", () => {
    const parsed = createMemoryRequestSchema.parse({
      type: "fact",
      content: "La réunion a lieu mardi.",
      confidence: 92,
      occurredAt: "2026-11-10T09:00:00.000Z",
      evidence: [{ sourceChunkId: chunkId, evidenceType: "supports", quote: "Mardi à 9 h." }],
    });
    assert.equal(parsed.evidence?.length, 1);
    assert.equal(parsed.confidence, 92);
  });

  it("rejects invalid confidence, reversed validity and unknown fields", () => {
    assert.equal(createMemoryRequestSchema.safeParse({ type: "fact", content: "X", confidence: 101 }).success, false);
    assert.equal(createMemoryRequestSchema.safeParse({ type: "fact", content: "X", validFrom: "2026-11-12T00:00:00.000Z", validUntil: "2026-11-10T00:00:00.000Z" }).success, false);
    assert.equal(createMemoryRequestSchema.safeParse({ type: "fact", content: "X", workspaceId: "client-controlled" }).success, false);
  });

  it("rejects duplicate evidence and malformed evidence references", () => {
    assert.equal(createMemoryRequestSchema.safeParse({ type: "fact", content: "X", evidence: [{ sourceChunkId: chunkId }, { sourceChunkId: chunkId }] }).success, false);
    assert.equal(createMemoryEvidenceSchema.safeParse({ sourceChunkId: "not-a-uuid" }).success, false);
  });

  it("requires non-empty updates and validates pagination filters", () => {
    assert.equal(updateMemoryRequestSchema.safeParse({}).success, false);
    assert.deepEqual(listMemoriesQuerySchema.parse({}), { status: "active", limit: 50, offset: 0 });
    assert.equal(listMemoriesQuerySchema.safeParse({ limit: "1000" }).success, false);
  });

  it("validates superseding memory payloads", () => {
    assert.equal(supersedeMemorySchema.safeParse({ type: "decision", content: "Nouvelle décision" }).success, true);
    assert.equal(supersedeMemorySchema.safeParse({ type: "decision", content: "X", validFrom: "2026-11-15T00:00:00.000Z", validUntil: "2026-11-01T00:00:00.000Z" }).success, false);
  });
});
