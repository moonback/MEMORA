import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createSourceSchema,
  listSourcesQuerySchema,
  replaceSourceChunksSchema,
} from "./source.controller.js";

describe("source request contracts", () => {
  it("accepts supported source types and a valid SHA-256 checksum", () => {
    const parsed = createSourceSchema.parse({
      type: "document",
      title: "Contrat",
      checksumSha256: "a".repeat(64),
    });
    assert.equal(parsed.checksumSha256, "a".repeat(64));
  });

  it("rejects malformed checksums and client-controlled storage keys", () => {
    assert.equal(createSourceSchema.safeParse({ type: "document", checksumSha256: "bad" }).success, false);
    assert.equal(createSourceSchema.safeParse({ type: "document", storageKey: "tenant-b/private.pdf" }).success, false);
  });

  it("applies safe pagination defaults and bounds", () => {
    assert.deepEqual(listSourcesQuerySchema.parse({}), { limit: 50, offset: 0 });
    assert.equal(listSourcesQuerySchema.safeParse({ limit: "1000" }).success, false);
  });

  it("rejects duplicate chunk ordinals and invalid time ranges", () => {
    const duplicate = replaceSourceChunksSchema.safeParse({
      chunks: [{ ordinal: 0, content: "A" }, { ordinal: 0, content: "B" }],
    });
    assert.equal(duplicate.success, false);
    const invalidRange = replaceSourceChunksSchema.safeParse({
      chunks: [{ ordinal: 0, content: "A", timeStartMs: 500, timeEndMs: 200 }],
    });
    assert.equal(invalidRange.success, false);
  });

  it("accepts ordered, workspace-ingestible chunks", () => {
    const parsed = replaceSourceChunksSchema.parse({
      chunks: [
        { ordinal: 0, content: "Page one", pageNumber: 1, tokenCount: 2 },
        { ordinal: 1, content: "Page two", pageNumber: 2, tokenCount: 2 },
      ],
    });
    assert.equal(parsed.chunks.length, 2);
  });
});
