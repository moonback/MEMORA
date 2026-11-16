import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  checksumHexToBase64, getObjectUploadTtlSeconds, MAX_SOURCE_OBJECT_BYTES,
  S3ObjectStorageService, validateUploadRequest,
} from "./object-storage.service.js";

const config = {
  endpoint: "https://s3.eu-west-1.example.invalid", region: "eu-west-1",
  accessKeyId: "test-access-key", secretAccessKey: "test-secret-key",
  bucket: "memora-test", provider: "s3-compatible",
};

describe("MEM-021 S3 lifecycle adapter", () => {
  it("validates bounded uploads and rejects caller-controlled storage coordinates", () => {
    const value = validateUploadRequest({ contentType: "application/pdf", byteSize: 1024, checksumSha256: "a".repeat(64) });
    assert.equal(value.byteSize, 1024);
    for (const byteSize of [0, -1, MAX_SOURCE_OBJECT_BYTES + 1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => validateUploadRequest({ contentType: "application/pdf", byteSize, checksumSha256: "a".repeat(64) }));
    }
    assert.throws(() => validateUploadRequest({ contentType: "application/pdf", byteSize: 10, checksumSha256: "bad" }));
    assert.throws(() => validateUploadRequest({ contentType: "application/pdf", byteSize: 10, checksumSha256: "a".repeat(64), objectKey: "foreign/key" }));
  });

  it("uses an independent, bounded server-side pending lifetime", () => {
    assert.equal(getObjectUploadTtlSeconds(undefined), 1800);
    assert.equal(getObjectUploadTtlSeconds("3600"), 3600);
    assert.throws(() => getObjectUploadTtlSeconds("299"));
    assert.throws(() => getObjectUploadTtlSeconds("86401"));
  });

  it("mocks PUT, HEAD, GET and DELETE requests", async () => {
    const service = new S3ObjectStorageService();
    const commands: unknown[] = [];
    const client = new S3Client({ endpoint: config.endpoint, region: config.region, forcePathStyle: true,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } });
    client.send = (async (command: unknown) => {
      commands.push(command);
      if (command instanceof HeadObjectCommand) return {
        ContentLength: 1024, ContentType: "application/pdf",
        ChecksumSHA256: checksumHexToBase64("a".repeat(64)), ETag: '"etag"',
      };
      if (command instanceof DeleteObjectCommand) return {};
      throw new Error("unexpected S3 command");
    }) as typeof client.send;
    service.configureClientForTests(client, config);
    service.configurePresignerForTests(async (_client, command) => {
      commands.push(command);
      return "https://presigned.invalid/temporary";
    });

    const upload = await service.createUploadUrl({
      workspaceId: "00000000-0000-4000-8000-000000000001",
      sourceId: "00000000-0000-4000-8000-000000000002",
      contentType: "application/pdf", byteSize: 1024, checksumSha256: "a".repeat(64),
    });
    assert.equal(upload.expiresIn, 300);
    assert.ok(upload.requiredHeaders["x-amz-checksum-sha256"]);
    const verified = await service.verifyUploadedObject({
      bucketName: config.bucket, objectKey: "workspace/source/object",
      expectedByteSize: 1024, expectedContentType: "application/pdf", expectedChecksumSha256: "a".repeat(64),
    });
    assert.equal(verified.byteSize, 1024);
    const download = await service.createDownloadUrl({ bucketName: config.bucket, objectKey: "workspace/source/object", contentType: "application/pdf" });
    assert.equal(download.expiresIn, 300);
    await service.deleteObject({ bucketName: config.bucket, objectKey: "workspace/source/object" });
    assert.ok(commands.some((command) => command instanceof PutObjectCommand));
    assert.ok(commands.some((command) => command instanceof HeadObjectCommand));
    assert.ok(commands.some((command) => command instanceof GetObjectCommand));
    assert.ok(commands.some((command) => command instanceof DeleteObjectCommand));
  });

  it("rejects mismatched size, content type and checksum metadata", async () => {
    const service = new S3ObjectStorageService();
    const client = new S3Client({ endpoint: config.endpoint, region: config.region, credentials: {
      accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey,
    } });
    client.send = (async () => ({ ContentLength: 1023, ContentType: "text/plain", ChecksumSHA256: "wrong" })) as typeof client.send;
    service.configureClientForTests(client, config);
    await assert.rejects(service.verifyUploadedObject({
      bucketName: config.bucket, objectKey: "private/key", expectedByteSize: 1024,
      expectedContentType: "application/pdf", expectedChecksumSha256: "a".repeat(64),
    }));
  });

  it("does not swallow S3 provider errors at the adapter boundary", async () => {
    const service = new S3ObjectStorageService();
    const client = new S3Client({ endpoint: config.endpoint, region: config.region, credentials: {
      accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey,
    } });
    client.send = (async () => { throw new Error("private provider diagnostic"); }) as typeof client.send;
    service.configureClientForTests(client, config);
    await assert.rejects(service.deleteObject({ bucketName: config.bucket, objectKey: "private/key" }));
  });
});
