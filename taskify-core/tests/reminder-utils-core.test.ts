import test from "node:test";
import assert from "node:assert/strict";
import {
  reminderPresetIdForMode,
  reminderPresetToMinutes,
  normalizeReminderTime,
  sanitizeReminderList,
} from "../dist/reminderUtils.js";

test("reminderPresetIdForMode maps zero by mode", () => {
  assert.equal(reminderPresetIdForMode(0, "timed"), "0h");
  assert.equal(reminderPresetIdForMode(0, "date"), "0d");
});

test("reminderPresetToMinutes parses builtin and custom", () => {
  assert.equal(reminderPresetToMinutes("1h"), 60);
  assert.equal(reminderPresetToMinutes("custom-90"), 90);
});

test("normalizeReminderTime normalizes hh:mm", () => {
  assert.equal(normalizeReminderTime("9:7"), "09:07");
});

test("sanitizeReminderList dedupes by minute and sorts", () => {
  const out = sanitizeReminderList(["1h", "custom-60", "5m", 60]);
  assert.deepEqual(out, ["5m", "1h"]);
});
