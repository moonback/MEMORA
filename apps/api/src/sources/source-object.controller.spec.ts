import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { SourceObjectController } from "./source-object.controller.js";
import { WORKSPACE_ROLES_KEY } from "../workspaces/workspace-membership.guard.js";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { SourceObjectController } from "./source-object.controller.js";
import { S3ObjectStorageService } from "./object-storage.service.js";

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


const adminUrl = process.env.DATABASE_URL;
const appUrl = process.env.DATABASE_APP_URL;
describe("MEM-021 repeated completion PostgreSQL integration", { skip: !adminUrl || !appUrl }, () => {
  const admin = new Client({ connectionString: adminUrl });
  const suffix = randomUUID();
  const authUserId = randomUUID();
  let userId: string;
  let workspaceId: string;
  let sourceId: string;

  before(async () => {
    await admin.connect();
    const user = await admin.query("INSERT INTO users (email, auth_user_id) VALUES ($1, $2) RETURNING id", [`mem021-complete-${suffix}@example.invalid`, authUserId]);
    userId = user.rows[0].id;
    const workspace = await admin.query("INSERT INTO workspaces (name, slug, owner_user_id) VALUES ('MEM-021 complete', $1, $2) RETURNING id", [`mem021-complete-${suffix}`, userId]);
    workspaceId = workspace.rows[0].id;
    await admin.query("INSERT INTO workspace_members (workspace_id, user_id, role, status, joined_at) VALUES ($1, $2, 'owner', 'active', now())", [workspaceId, userId]);
    const source = await admin.query("INSERT INTO sources (workspace_id, created_by_user_id, type, title) VALUES ($1, $2, 'document', 'Already verified') RETURNING id", [workspaceId, userId]);
    sourceId = source.rows[0].id;
    await admin.query(
      `INSERT INTO source_objects (workspace_id, source_id, storage_provider, bucket_name, object_key, status, content_type, byte_size, checksum_sha256, uploaded_at, verified_at, expires_at)
       VALUES ($1, $2, 's3-compatible', 'memora-test', $3, 'verified', 'application/pdf', 8, $4, now(), now(), now() + interval '1 hour')`,
      [workspaceId, sourceId, `already-verified/${suffix}`, "f".repeat(64)],
    );
  });

  after(async () => {
    if (workspaceId) await admin.query("DELETE FROM workspaces WHERE id = $1", [workspaceId]);
    if (userId) await admin.query("DELETE FROM users WHERE id = $1", [userId]);
    await admin.end();
  });

  it("returns verified repeatedly without making another S3 HEAD request", async () => {
    const storage = new S3ObjectStorageService();
    let headCalls = 0;
    storage.verifyUploadedObject = async () => {
      headCalls += 1;
      throw new Error("must not verify an already verified object again");
    };
    const controller = new SourceObjectController(storage);
    const actor = { workspaceId, authUserId, userId, role: "owner" as const, workspaceType: "personal" as const };
    const first = await controller.completeUpload(workspaceId, sourceId, actor);
    const second = await controller.completeUpload(workspaceId, sourceId, actor);
    assert.deepEqual(first, { objectId: (await admin.query("SELECT id FROM source_objects WHERE source_id = $1", [sourceId])).rows[0].id, status: "verified" });
    assert.deepEqual(second, first);
    assert.equal(headCalls, 0);
  });
});
