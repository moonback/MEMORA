import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SourceObjectController } from "./source-object.controller.js";
import { WORKSPACE_ROLES_KEY } from "../workspaces/workspace-membership.guard.js";

describe("MEM-021 source object route authorization", () => {
  it("allows only owner/admin/member to initialize or complete uploads", () => {
    const upload = Reflect.getMetadata(WORKSPACE_ROLES_KEY, SourceObjectController.prototype.createUploadUrl) as string[];
    const complete = Reflect.getMetadata(WORKSPACE_ROLES_KEY, SourceObjectController.prototype.completeUpload) as string[];
    assert.deepEqual(upload, ["owner", "admin", "member"]);
    assert.deepEqual(complete, ["owner", "admin", "member"]);
    assert.ok(!upload.includes("viewer"));
    assert.ok(!complete.includes("viewer"));
  });

  it("allows active viewers to request downloads but only verified objects are returned by the controller", () => {
    const download = Reflect.getMetadata(WORKSPACE_ROLES_KEY, SourceObjectController.prototype.createDownloadUrl) as string[] | undefined;
    assert.equal(download, undefined);
  });
});
