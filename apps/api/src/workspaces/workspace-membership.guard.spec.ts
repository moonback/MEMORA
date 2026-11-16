import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

describe("workspace authorization wiring", () => {
  it("registers authentication as the global API guard and membership guard as a provider", async () => {
    const source = await readFile(new URL("../app.module.ts", import.meta.url), "utf8");
    assert.match(source, /provide: APP_GUARD, useClass: AuthGuard/);
    assert.match(source, /WorkspaceMembershipGuard/);
  });

  it("requires active membership and rejects archived workspaces", async () => {
    const source = await readFile(new URL("./workspace-membership.guard.ts", import.meta.url), "utf8");
    assert.match(source, /wm\.status = 'active'/);
    assert.match(source, /if \(membership\.archived_at\)/);
    assert.match(source, /allowedRoles\.includes\(membership\.role\)/);
  });

  it("limits membership and invitation controllers with the membership guard", async () => {
    const membership = await readFile(new URL("./workspace-membership.controller.ts", import.meta.url), "utf8");
    const invitations = await readFile(new URL("./workspace-invitation.controller.ts", import.meta.url), "utf8");
    assert.match(membership, /@UseGuards\(WorkspaceMembershipGuard\)/);
    assert.match(invitations, /@UseGuards\(WorkspaceMembershipGuard\)/);
  });
});
