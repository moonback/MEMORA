import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { profileUpdateSchema } from "./account.controller.js";

describe("profileUpdateSchema", () => {
  it("accepts supported locale and IANA time-zone preferences", () => {
    const result = profileUpdateSchema.safeParse({
      name: "Maysson",
      locale: "fr-FR",
      timeZone: "Europe/Paris",
    });
    assert.equal(result.success, true);
  });

  it("rejects empty updates and blank display names", () => {
    assert.equal(profileUpdateSchema.safeParse({}).success, false);
    assert.equal(profileUpdateSchema.safeParse({ name: "   " }).success, false);
  });

  it("rejects invalid locales, time zones and unexpected fields", () => {
    assert.equal(profileUpdateSchema.safeParse({ locale: "not_a_locale" }).success, false);
    assert.equal(profileUpdateSchema.safeParse({ timeZone: "Mars/Olympus" }).success, false);
    assert.equal(profileUpdateSchema.safeParse({ role: "admin" }).success, false);
  });

  it("enforces the display-name length limit", () => {
    assert.equal(profileUpdateSchema.safeParse({ name: "x".repeat(161) }).success, false);
  });
});
