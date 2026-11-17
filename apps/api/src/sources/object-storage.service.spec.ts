import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
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

  it("reads an S3 object and verifies its size and SHA-256", async () => {
    const service = new S3ObjectStorageService();
    const payload = Buffer.from("MEMORA secure ingestion test");
    const checksum = createHash("sha256").update(payload).digest("hex");

    const client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });

    client.send = (async (command: unknown) => {
      assert.ok(command instanceof GetObjectCommand);
      return {
        Body: Readable.from([
          payload.subarray(0, 10),
          payload.subarray(10),
        ]),
        ContentLength: payload.length,
      };
    }) as typeof client.send;

    service.configureClientForTests(client, config);

    const result = await service.readObject({
      bucketName: config.bucket,
      objectKey: "workspace/source/object",
      expectedByteSize: payload.length,
      expectedChecksumSha256: checksum,
    });

    assert.deepEqual(result, payload);
  });

  it("rejects an S3 stream exceeding the expected size", async () => {
    const service = new S3ObjectStorageService();
    const client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });

    client.send = (async () => ({
      Body: Readable.from([
        Buffer.from("1234"),
        Buffer.from("5678"),
      ]),
      ContentLength: 4,
    })) as typeof client.send;

    service.configureClientForTests(client, config);

    await assert.rejects(
      service.readObject({
        bucketName: config.bucket,
        objectKey: "private/key",
        expectedByteSize: 4,
        expectedChecksumSha256: "a".repeat(64),
      }),
      /source_object_size_limit_exceeded/,
    );
  });

  it("rejects an interrupted S3 stream", async () => {
    const service = new S3ObjectStorageService();
    const client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });

    async function* interruptedStream() {
      yield Buffer.from("partial");
      throw new Error("stream interrupted");
    }

    client.send = (async () => ({
      Body: Readable.from(interruptedStream()),
      ContentLength: 20,
    })) as typeof client.send;

    service.configureClientForTests(client, config);

    await assert.rejects(
      service.readObject({
        bucketName: config.bucket,
        objectKey: "private/key",
        expectedByteSize: 20,
        expectedChecksumSha256: "a".repeat(64),
      }),
      /stream interrupted/,
    );
  });

  it("rejects an object with an incorrect SHA-256", async () => {
    const service = new S3ObjectStorageService();
    const payload = Buffer.from("incorrect checksum");

    const client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });

    client.send = (async () => ({
      Body: Readable.from([payload]),
      ContentLength: payload.length,
    })) as typeof client.send;

    service.configureClientForTests(client, config);

    await assert.rejects(
      service.readObject({
        bucketName: config.bucket,
        objectKey: "private/key",
        expectedByteSize: payload.length,
        expectedChecksumSha256: "a".repeat(64),
      }),
      /source_object_checksum_mismatch/,
    );
  });

  it("rejects an invalid expected object size before contacting S3", async () => {
    const service = new S3ObjectStorageService();
    const client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });

    let called = false;
    client.send = (async () => {
      called = true;
      return {};
    }) as typeof client.send;

    service.configureClientForTests(client, config);

    await assert.rejects(
      service.readObject({
        bucketName: config.bucket,
        objectKey: "private/key",
        expectedByteSize: MAX_SOURCE_OBJECT_BYTES + 1,
        expectedChecksumSha256: "a".repeat(64),
      }),
      /source_object_size_invalid/,
    );

    assert.equal(called, false);
  });
});
