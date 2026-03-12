import test from "node:test";
import assert from "node:assert/strict";
import { normalizeNip05, contactInitials, contactVerifiedNip05 } from "../dist/contactContracts.js";

test("normalizeNip05 lowercases and validates", () => {
  assert.equal(normalizeNip05("Alice@Example.com"), "alice@example.com");
  assert.equal(normalizeNip05("bad"), null);
});

test("contactInitials handles simple names", () => {
  assert.equal(contactInitials("Jane Doe"), "JD");
  assert.equal(contactInitials("x"), "X");
});

test("contactVerifiedNip05 validates against cache", () => {
  const contact = { id: "1", nip05: "a@b.com", npub: "a".repeat(64) };
  const cache = { "1": { status: "valid", nip05: "a@b.com", npub: "a".repeat(64), checkedAt: 1 } };
  assert.equal(contactVerifiedNip05(contact, cache as any), "a@b.com");
});
