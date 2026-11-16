import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertSafeJobData, ingestionJobId, redisConnectionOptions, retryDelayMs } from "./source-ingestion-queue.js";

describe("MEM-024 BullMQ payload and retry contract", () => {
  it("accepts only the three UUID identifiers and rejects private fields", () => {
    const data = {
      ingestionId: "11111111-1111-4111-8111-111111111111",
      sourceId: "22222222-2222-4222-8222-222222222222",
      workspaceId: "33333333-3333-4333-8333-333333333333",
    };
    assert.deepEqual(assertSafeJobData(data), data);
    assert.throws(() => assertSafeJobData({ ...data, title: "private document title" }));
    assert.throws(() => assertSafeJobData({ ...data, content: "private content" }));
    assert.equal(ingestionJobId(data.ingestionId), `source-ingestion-${data.ingestionId}`);
  });

  it("bounds exponential retry delays", () => {
    assert.equal(retryDelayMs(1), 2000);
    assert.equal(retryDelayMs(2), 4000);
    assert.equal(retryDelayMs(99), 256000);
  });

  it("parses local Redis connection configuration without logging credentials", () => {
    const previous = process.env.REDIS_URL;
    process.env.REDIS_URL = "redis://user:secret@localhost:6380/2";
    try {
      const options = redisConnectionOptions();
      assert.equal(options.host, "localhost");
      assert.equal(options.port, 6380);
      assert.equal(options.db, 2);
      assert.equal(options.username, "user");
      assert.equal(options.password, "secret");
      assert.equal(options.maxRetriesPerRequest, null);
    } finally {
      if (previous === undefined) delete process.env.REDIS_URL;
      else process.env.REDIS_URL = previous;
    }
  });
});
