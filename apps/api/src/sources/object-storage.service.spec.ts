import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  checksumHexToBase64,
  MAX_SOURCE_OBJECT_BYTES,
  validateUploadRequest,
} from "./object-storage.service.js";

describe("MEM-020 private object upload contract", () => {
  it("accepts a bounded upload with a SHA-256 checksum", () => {
    const value = validateUploadRequest({
      contentType: "application/pdf",
      byteSize: 1024,
      checksumSha256: "a".repeat(64),
    });
    assert.equal(value.byteSize, 1024);
    assert.equal(value.checksumSha256, "a".repeat(64));
  });

  it("rejects oversized, empty and non-integer uploads", () => {
    for (const byteSize of [0, -1, MAX_SOURCE_OBJECT_BYTES + 1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => validateUploadRequest({
        contentType: "application/pdf",
        byteSize,
        checksumSha256: "a".repeat(64),
      }));
    }
  });

  it("rejects malformed MIME types, checksums and caller-controlled storage keys", () => {
    assert.throws(() => validateUploadRequest({ contentType: "not-a-mime", byteSize: 10, checksumSha256: "a".repeat(64) }));
    assert.throws(() => validateUploadRequest({ contentType: "application/pdf", byteSize: 10, checksumSha256: "bad" }));
    assert.throws(() => validateUploadRequest({ contentType: "application/pdf", byteSize: 10, checksumSha256: "a".repeat(64), objectKey: "other-tenant/file" }));
  });

  it("converts hexadecimal SHA-256 values to S3 checksum encoding", () => {
    assert.equal(checksumHexToBase64("00".repeat(32)), Buffer.alloc(32).toString("base64"));
  });
});
