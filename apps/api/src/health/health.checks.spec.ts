import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getReadiness, type DependencyCheck } from "./health.checks";

describe("getReadiness", () => {
  it("reports ok only when both dependencies respond", async () => {
    const probe = async (): Promise<DependencyCheck> => ({
      status: "ok",
      latencyMs: 2,
    });
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
