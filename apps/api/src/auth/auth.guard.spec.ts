import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

describe("authentication route policy", () => {
  it("keeps both health endpoints explicitly public", async () => {
    const source = await readFile(new URL("../health/health.controller.ts", import.meta.url), "utf8");
    assert.match(source, /@Public\(\)\s+@Get\("health"\)/);
    assert.match(source, /@Public\(\)\s+@Get\("health\/ready"\)/);
  });

  it("exposes the current account only through the protected account controller", async () => {
    const source = await readFile(new URL("./account.controller.ts", import.meta.url), "utf8");
    assert.match(source, /@Get\("me"\)/);
    assert.match(source, /CurrentSession/);
    assert.match(source, /UnauthorizedException/);
  });

  it("fails closed when a protected request has no session", async () => {
    const source = await readFile(new URL("./auth.guard.ts", import.meta.url), "utf8");
    assert.match(source, /if \(!session\) throw new UnauthorizedException/);
    assert.match(source, /auth\.api\.getSession/);
  });
});
