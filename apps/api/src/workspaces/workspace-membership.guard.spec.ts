import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

describe("workspace authorization wiring", () => {
  it("registers authentication as the global API guard and membership guard as a provider", async () => {
    const source = await readFile(new URL("../app.module.ts", import.meta.url), "utf8");
    assert.match(source, /provide: APP_GUARD, useClass: AuthGuard/);
    assert.match(source, /WorkspaceMembershipGuard/);
  });

  it("resolves active membership and archived state through the RLS context helper", async () => {
    const source = await readFile(new URL("./workspace-membership.guard.ts", import.meta.url), "utf8");
    const context = await readFile(new URL("../database/tenant-context.ts", import.meta.url), "utf8");
    assert.match(source, /withWorkspaceContext/);
    assert.match(source, /allowedRoles\.includes\(membership\.role\)/);
    assert.match(context, /status = 'active'/);
    assert.match(context, /workspace\.archived_at/);
  });

  it("limits membership and invitation controllers with the membership guard", async () => {
    const membership = await readFile(new URL("./workspace-membership.controller.ts", import.meta.url), "utf8");
    const invitations = await readFile(new URL("./workspace-invitation.controller.ts", import.meta.url), "utf8");
    assert.match(membership, /@UseGuards\(WorkspaceMembershipGuard\)/);
    assert.match(invitations, /@UseGuards\(WorkspaceMembershipGuard\)/);
  });
});
