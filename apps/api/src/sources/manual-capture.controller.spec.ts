import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Reflect } from "@nestjs/core";
import { manualCaptureSchema, ManualCaptureController } from "./manual-capture.controller.js";

describe("manual capture request contract", () => {
  it("accepts a bounded note with an optional capture timestamp", () => {
    const parsed = manualCaptureSchema.parse({
      title: "  Idée de projet  ",
      content: "  Première note.  ",
      capturedAt: "2026-11-16T12:00:00.000Z",
    });
    assert.equal(parsed.title, "Idée de projet");
    assert.equal(parsed.content, "Première note.");
  });

  it("rejects empty content, oversized fields and unknown properties", () => {
    assert.equal(manualCaptureSchema.safeParse({ title: "Note", content: " " }).success, false);
    assert.equal(manualCaptureSchema.safeParse({ title: "Note", content: "x".repeat(20_001) }).success, false);
    assert.equal(manualCaptureSchema.safeParse({ title: "Note", content: "Texte", workspaceId: "attacker" }).success, false);
  });

  it("rejects invalid capture timestamps", () => {
    assert.equal(manualCaptureSchema.safeParse({ title: "Note", content: "Texte", capturedAt: "yesterday" }).success, false);
  });
});
