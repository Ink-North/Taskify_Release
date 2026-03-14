import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const RUNTIME = readFileSync(path.resolve(import.meta.dirname, "../src/nostrRuntime.ts"), "utf8");
const CRYPTO = readFileSync(path.resolve(import.meta.dirname, "../src/calendarCrypto.ts"), "utf8");

test("calendarCrypto exports NIP-44 encrypt/decrypt for board key", () => {
  assert.match(CRYPTO, /export async function encryptCalendarPayloadForBoard/);
  assert.match(CRYPTO, /export async function decryptCalendarPayloadForBoard/);
  assert.match(CRYPTO, /nip44\.v2/);
});

test("calendarCrypto exports event key encrypt/decrypt", () => {
  assert.match(CRYPTO, /export async function encryptCalendarPayloadWithEventKey/);
  assert.match(CRYPTO, /export async function decryptCalendarPayloadWithEventKey/);
});

test("calendarCrypto exports generateEventKey", () => {
  assert.match(CRYPTO, /export function generateEventKey/);
});

test("nostrRuntime imports from calendarCrypto", () => {
  assert.match(RUNTIME, /from "\.\/calendarCrypto\.js"/);
  assert.match(RUNTIME, /decryptCalendarPayloadForBoard/);
  assert.match(RUNTIME, /encryptCalendarPayloadForBoard/);
});

test("publishCalendarEvent emits kind 30310 (TASKIFY_CALENDAR_EVENT_KIND)", () => {
  assert.match(RUNTIME, /async function publishCalendarEvent/);
  assert.match(RUNTIME, /event\.kind = TASKIFY_CALENDAR_EVENT_KIND/);
});

test("fetchBoardCalendarEvents subscribes to kinds 30310 and 30311", () => {
  assert.match(RUNTIME, /async function fetchBoardCalendarEvents/);
  assert.match(RUNTIME, /TASKIFY_CALENDAR_EVENT_KIND.*TASKIFY_CALENDAR_VIEW_KIND|kinds.*30310.*30311/);
});

test("parseDecryptedCalendarEvent falls back to AES-GCM if NIP-44 fails", () => {
  assert.match(RUNTIME, /decryptCalendarPayloadForBoard[\s\S]*?catch[\s\S]*?decryptContent/);
});

test("createEvent uses publishCalendarEvent not publishTaskEvent", () => {
  assert.match(RUNTIME, /createEvent[\s\S]*?publishCalendarEvent/);
});

test("updateEvent uses publishCalendarEvent not publishTaskEvent", () => {
  assert.match(RUNTIME, /updateEvent[\s\S]*?publishCalendarEvent/);
});

test("deleteEvent uses publishCalendarEvent not publishTaskEvent", () => {
  assert.match(RUNTIME, /deleteEvent[\s\S]*?publishCalendarEvent/);
});

test("listEvents uses fetchBoardCalendarEvents", () => {
  assert.match(RUNTIME, /listEvents[\s\S]*?fetchBoardCalendarEvents/);
});

test("nostrRuntime imports TASKIFY_CALENDAR_EVENT_KIND and TASKIFY_CALENDAR_VIEW_KIND", () => {
  assert.match(RUNTIME, /TASKIFY_CALENDAR_EVENT_KIND/);
  assert.match(RUNTIME, /TASKIFY_CALENDAR_VIEW_KIND/);
});

test("publishCalendarEvent adds entity event tag", () => {
  assert.match(RUNTIME, /publishCalendarEvent[\s\S]*?\["entity", "event"\]/);
});

test("validateCalendarEventCompat accepts kind 30310 and 30311", () => {
  assert.match(RUNTIME, /function validateCalendarEventCompat/);
  assert.match(RUNTIME, /validateCalendarEventCompat[\s\S]*?TASKIFY_CALENDAR_EVENT_KIND[\s\S]*?TASKIFY_CALENDAR_VIEW_KIND/);
});
