import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCalendarMutationPayload } from "../dist/mutationContracts.js";

test("normalizeCalendarMutationPayload returns normalized payload with createdAt", () => {
  const out = normalizeCalendarMutationPayload(
    {
      kind: "time",
      title: "Daily sync",
      startISO: "2026-03-12T15:00:00.000Z",
      endISO: "2026-03-12T15:15:00.000Z",
    },
    123456,
  );
  assert.ok(out);
  assert.equal(out?.title, "Daily sync");
  assert.equal(out?.createdAt, 123456);
});

test("normalizeCalendarMutationPayload returns null for invalid event payload", () => {
  const out = normalizeCalendarMutationPayload(
    {
      kind: "time",
      title: "Bad",
    },
    123456,
  );
  assert.equal(out, null);
});
