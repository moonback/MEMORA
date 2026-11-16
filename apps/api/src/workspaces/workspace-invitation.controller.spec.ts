import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { invitationSchema } from "./workspace-invitation.controller.js";

describe("invitationSchema", () => {
  it("normalizes a valid invitation payload and defaults to member", () => {
    const result = invitationSchema.safeParse({ email: "person@example.com" });
    assert.equal(result.success, true);
    if (result.success) assert.equal(result.data.role, "member");
  });

  it("accepts explicit admin, member and viewer roles", () => {
    for (const role of ["admin", "member", "viewer"]) {
      assert.equal(invitationSchema.safeParse({ email: "person@example.com", role }).success, true);
    }
  });

  it("rejects owner invitations, invalid addresses and extra properties", () => {
    assert.equal(invitationSchema.safeParse({ email: "person@example.com", role: "owner" }).success, false);
    assert.equal(invitationSchema.safeParse({ email: "not-an-email" }).success, false);
    assert.equal(invitationSchema.safeParse({ email: "person@example.com", isAdmin: true }).success, false);
  });
});
