import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createInvitationToken, hashInvitationToken } from "./invitation-token.js";

describe("workspace invitation tokens", () => {
  it("generates high-entropy URL-safe tokens and stores only a SHA-256 hash", () => {
    const { token, tokenHash } = createInvitationToken();
    assert.match(token, /^[A-Za-z0-9_-]{40,}$/);
    assert.match(tokenHash, /^[a-f0-9]{64}$/);
    assert.notEqual(token, tokenHash);
    assert.equal(hashInvitationToken(token), tokenHash);
  });

  it("produces different hashes for different tokens", () => {
    assert.notEqual(hashInvitationToken("first-token"), hashInvitationToken("second-token"));
  });
});
