import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canChangeMemberRole, canInviteRole, canLeaveWorkspace, canRemoveMember } from "./workspace-rbac.js";

describe("workspace RBAC policy", () => {
  it("allows owners to invite all non-owner roles and admins only member/viewer", () => {
    assert.equal(canInviteRole("owner", "admin"), true);
    assert.equal(canInviteRole("owner", "member"), true);
    assert.equal(canInviteRole("admin", "member"), true);
    assert.equal(canInviteRole("admin", "viewer"), true);
    assert.equal(canInviteRole("admin", "admin"), false);
    assert.equal(canInviteRole("member", "member"), false);
  });

  it("prevents admins from modifying owners or administrators", () => {
    assert.equal(canChangeMemberRole("owner", "admin", "member"), true);
    assert.equal(canChangeMemberRole("owner", "member", "admin"), true);
    assert.equal(canChangeMemberRole("admin", "member", "viewer"), true);
    assert.equal(canChangeMemberRole("admin", "viewer", "member"), true);
    assert.equal(canChangeMemberRole("admin", "admin", "member"), false);
    assert.equal(canChangeMemberRole("admin", "member", "admin"), false);
    assert.equal(canChangeMemberRole("member", "member", "viewer"), false);
    assert.equal(canChangeMemberRole("owner", "owner", "admin"), false);
  });

  it("restricts removal and self-leave around ownership", () => {
    assert.equal(canRemoveMember("owner", "admin"), true);
    assert.equal(canRemoveMember("owner", "member"), true);
    assert.equal(canRemoveMember("admin", "member"), true);
    assert.equal(canRemoveMember("admin", "viewer"), true);
    assert.equal(canRemoveMember("admin", "admin"), false);
    assert.equal(canRemoveMember("member", "viewer"), false);
    assert.equal(canRemoveMember("owner", "owner"), false);
    assert.equal(canLeaveWorkspace("owner"), false);
    assert.equal(canLeaveWorkspace("admin"), true);
    assert.equal(canLeaveWorkspace("member"), true);
    assert.equal(canLeaveWorkspace("viewer"), true);
  });
});
