import test from "node:test";
import assert from "node:assert/strict";
import { startOfWeekLocal, isoForWeekdayLocal } from "../dist/weekDate.js";

test("startOfWeekLocal defaults unsupported weekStart to Sunday", () => {
  const d = new Date("2026-03-12T12:00:00.000Z");
  const sow = startOfWeekLocal(d, 3 as 0);
  assert.equal(sow.getUTCDay(), 0);
});

test("isoForWeekdayLocal returns target weekday in same week", () => {
  const base = new Date("2026-03-12T12:00:00.000Z"); // Thu
  const iso = isoForWeekdayLocal(1, { base, weekStart: 1 }); // Monday
  const d = new Date(iso);
  assert.equal(d.getUTCDay(), 1);
});
