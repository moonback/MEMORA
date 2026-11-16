import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getReadiness, probeTcp, type DependencyCheck } from "./health.checks.js";

describe("getReadiness", () => {
  it("reports ok only when both dependencies respond", async () => {
    const probe = async (): Promise<DependencyCheck> => ({ status: "ok", latencyMs: 2 });
    const result = await getReadiness(
      { DATABASE_URL: "postgres://localhost/db", REDIS_URL: "redis://localhost" },
      probe,
    );
    assert.equal(result.status, "ok");
    assert.equal(result.dependencies.database.status, "ok");
    assert.equal(result.dependencies.redis.status, "ok");
    assert.ok(Number.isFinite(Date.parse(result.timestamp)));
  });

  it("reports degraded when one dependency is unavailable", async () => {
    const probe = async (url: string): Promise<DependencyCheck> =>
      url.startsWith("postgres")
        ? { status: "ok" }
        : { status: "unavailable", message: "ECONNREFUSED" };
    const result = await getReadiness(
      { DATABASE_URL: "postgres://localhost/db", REDIS_URL: "redis://localhost" },
      probe,
    );
    assert.equal(result.status, "degraded");
    assert.equal(result.dependencies.redis.status, "unavailable");
  });

  it("does not claim readiness when dependency URLs are missing", async () => {
    const result = await getReadiness({});
    assert.equal(result.status, "degraded");
    assert.equal(result.dependencies.database.status, "unconfigured");
    assert.equal(result.dependencies.redis.status, "unconfigured");
  });

  it("marks malformed connection URLs unavailable instead of throwing", async () => {
    const result = await getReadiness(
      { DATABASE_URL: "not-a-url", REDIS_URL: "redis://localhost" },
      async (url) =>
        url === "not-a-url"
          ? { status: "unavailable", message: "Invalid connection URL" }
          : { status: "ok" },
    );
    assert.equal(result.status, "degraded");
    assert.equal(result.dependencies.database.status, "unavailable");
  });
});

import { createServer } from "node:net";

describe("probeTcp", () => {
  it("detects an accepting TCP service", async () => {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    try {
      const result = await probeTcp(`redis://127.0.0.1:${address.port}`);
      assert.equal(result.status, "ok");
      assert.ok(typeof result.latencyMs === "number");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("returns unavailable for malformed URLs", async () => {
    const result = await probeTcp("not-a-url");
    assert.equal(result.status, "unavailable");
    assert.equal(result.message, "Invalid connection URL");
  });
});
