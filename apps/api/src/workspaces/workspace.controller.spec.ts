import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { workspaceUpdateSchema } from "./workspace.controller.js";

describe("workspaceUpdateSchema", () => {
  it("accepts a valid name, description and appearance metadata", () => {
    const result = workspaceUpdateSchema.safeParse({
      name: "Mon espace",
      description: "Mes informations personnelles",
      metadata: { accentColor: "#6259D6", icon: "brain" },
    });
    assert.equal(result.success, true);
  });

  it("allows clearing a description", () => {
    assert.equal(workspaceUpdateSchema.safeParse({ description: null }).success, true);
  });

  it("rejects empty updates, invalid colors and unexpected fields", () => {
    assert.equal(workspaceUpdateSchema.safeParse({}).success, false);
    assert.equal(workspaceUpdateSchema.safeParse({ metadata: { accentColor: "purple" } }).success, false);
    assert.equal(workspaceUpdateSchema.safeParse({ ownerUserId: "other-user" }).success, false);
  });

  it("enforces workspace name and description limits", () => {
    assert.equal(workspaceUpdateSchema.safeParse({ name: "x".repeat(121) }).success, false);
    assert.equal(workspaceUpdateSchema.safeParse({ description: "x".repeat(501) }).success, false);
  });
});
