import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { roleUpdateSchema } from "./workspace-membership.controller.js";

describe("roleUpdateSchema", () => {
  it("accepts assignable non-owner roles", () => {
    for (const role of ["admin", "member", "viewer"]) {
      assert.equal(roleUpdateSchema.safeParse({ role }).success, true);
    }
  });

  it("never allows a caller to assign the owner role or extra fields", () => {
    assert.equal(roleUpdateSchema.safeParse({ role: "owner" }).success, false);
    assert.equal(roleUpdateSchema.safeParse({ role: "admin", userId: "other" }).success, false);
  });
});
