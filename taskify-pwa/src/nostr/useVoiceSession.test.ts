/**
 * useVoiceSession reducer tests
 *
 * These tests are EXPECTED TO FAIL until useVoiceSession.ts is implemented.
 * They test only the pure reducer — no DOM, no Web Speech API, no Gemini calls.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { voiceSessionReducer, INITIAL_VOICE_SESSION } from "./useVoiceSession.ts";
import type { VoiceSession, VoiceSessionAction, TaskCandidate } from "./useVoiceSession.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCandidate(overrides: Partial<TaskCandidate> = {}): TaskCandidate {
  return {
    id: "test-id-1",
    title: "Test task",
    status: "draft",
    ...overrides,
  };
}

function dispatch(state: VoiceSession, action: VoiceSessionAction): VoiceSession {
  return voiceSessionReducer(state, action);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

// Test 1: initial state shape
test("INITIAL_VOICE_SESSION has expected default shape", () => {
  assert.deepEqual(INITIAL_VOICE_SESSION, {
    transcript: "",
    interimTranscript: "",
    candidates: [],
    operations: [],
    isListening: false,
    isProcessing: false,
    quotaExhausted: false,
  });
});

// Test 2: SET_INTERIM updates interimTranscript
test("SET_INTERIM updates interimTranscript only", () => {
  const state = dispatch(INITIAL_VOICE_SESSION, { type: "SET_INTERIM", text: "call dentist" });
  assert.equal(state.interimTranscript, "call dentist");
  assert.equal(state.transcript, "");
  assert.deepEqual(state.candidates, []);
});

// Test 3: COMMIT_TRANSCRIPT appends to transcript, clears interim
test("COMMIT_TRANSCRIPT appends final text to transcript and clears interim", () => {
  const s1 = dispatch(INITIAL_VOICE_SESSION, { type: "SET_INTERIM", text: "call dentist" });
  const s2 = dispatch(s1, { type: "COMMIT_TRANSCRIPT", text: "call dentist" });
  assert.equal(s2.transcript, "call dentist");
  assert.equal(s2.interimTranscript, "");
});

// Test 4: COMMIT_TRANSCRIPT accumulates across multiple finals
test("COMMIT_TRANSCRIPT accumulates multiple final transcripts with a space separator", () => {
  let s = INITIAL_VOICE_SESSION;
  s = dispatch(s, { type: "COMMIT_TRANSCRIPT", text: "call dentist friday" });
  s = dispatch(s, { type: "COMMIT_TRANSCRIPT", text: "also pick up groceries" });
  assert.equal(s.transcript, "call dentist friday also pick up groceries");
});

// Test 5: APPLY_OPERATIONS create_task appends a draft candidate
test("APPLY_OPERATIONS create_task appends new draft candidate", () => {
  const state = dispatch(INITIAL_VOICE_SESSION, {
    type: "APPLY_OPERATIONS",
    operations: [{ type: "create_task", title: "Call dentist", dueText: "friday 2pm" }],
  });
  assert.equal(state.candidates.length, 1);
  assert.equal(state.candidates[0].title, "Call dentist");
  assert.equal(state.candidates[0].dueText, "friday 2pm");
  assert.equal(state.candidates[0].status, "draft");
  assert.ok(typeof state.candidates[0].id === "string", "id should be assigned");
  assert.ok(state.candidates[0].id.length > 0);
});

// Test 6: APPLY_OPERATIONS create_task assigns unique IDs per candidate
test("APPLY_OPERATIONS create_task assigns unique IDs for each candidate", () => {
  const state = dispatch(INITIAL_VOICE_SESSION, {
    type: "APPLY_OPERATIONS",
    operations: [
      { type: "create_task", title: "Task A" },
      { type: "create_task", title: "Task B" },
    ],
  });
  assert.equal(state.candidates.length, 2);
  assert.notEqual(state.candidates[0].id, state.candidates[1].id);
});

// Test 7: APPLY_OPERATIONS update_task with targetRef "last_task" mutates last candidate
test("APPLY_OPERATIONS update_task with targetRef last_task mutates the last candidate in place", () => {
  let s = dispatch(INITIAL_VOICE_SESSION, {
    type: "APPLY_OPERATIONS",
    operations: [
      { type: "create_task", title: "Call dentist" },
      { type: "create_task", title: "Pick up groceries" },
    ],
  });
  const secondId = s.candidates[1].id;
  s = dispatch(s, {
    type: "APPLY_OPERATIONS",
    operations: [{ type: "update_task", targetRef: "last_task", changes: { dueText: "tomorrow 3pm" } }],
  });
  assert.equal(s.candidates.length, 2, "no extra candidates created");
  assert.equal(s.candidates[1].id, secondId, "same id");
  assert.equal(s.candidates[1].dueText, "tomorrow 3pm");
  assert.equal(s.candidates[1].title, "Pick up groceries", "title unchanged");
});

// Test 8: APPLY_OPERATIONS delete_task sets status to dismissed
test("APPLY_OPERATIONS delete_task sets candidate status to dismissed", () => {
  let s = dispatch(INITIAL_VOICE_SESSION, {
    type: "APPLY_OPERATIONS",
    operations: [{ type: "create_task", title: "Call dentist" }],
  });
  const id = s.candidates[0].id;
  s = dispatch(s, {
    type: "APPLY_OPERATIONS",
    operations: [{ type: "delete_task", targetRef: "last_task" }],
  });
  assert.equal(s.candidates[0].id, id);
  assert.equal(s.candidates[0].status, "dismissed");
});

// Test 9: APPLY_OPERATIONS mark_uncertain keeps candidate as draft
test("APPLY_OPERATIONS mark_uncertain keeps candidate status as draft", () => {
  let s = dispatch(INITIAL_VOICE_SESSION, {
    type: "APPLY_OPERATIONS",
    operations: [{ type: "create_task", title: "Something vague" }],
  });
  s = dispatch(s, {
    type: "APPLY_OPERATIONS",
    operations: [{ type: "mark_uncertain", targetRef: "last_task" }],
  });
  assert.equal(s.candidates[0].status, "draft");
});

// Test 10: DISMISS_CANDIDATE sets status to dismissed by id
test("DISMISS_CANDIDATE sets the target candidate status to dismissed", () => {
  let s = dispatch(INITIAL_VOICE_SESSION, {
    type: "APPLY_OPERATIONS",
    operations: [
      { type: "create_task", title: "Task A" },
      { type: "create_task", title: "Task B" },
    ],
  });
  const idA = s.candidates[0].id;
  const idB = s.candidates[1].id;
  s = dispatch(s, { type: "DISMISS_CANDIDATE", id: idA });
  assert.equal(s.candidates[0].status, "dismissed");
  assert.equal(s.candidates[1].status, "draft", "other candidates unaffected");
  assert.equal(s.candidates[1].id, idB);
});

// Test 11: CONFIRM_CANDIDATE sets status to confirmed by id
test("CONFIRM_CANDIDATE sets the target candidate status to confirmed", () => {
  let s = dispatch(INITIAL_VOICE_SESSION, {
    type: "APPLY_OPERATIONS",
    operations: [{ type: "create_task", title: "Task A" }],
  });
  const id = s.candidates[0].id;
  s = dispatch(s, { type: "CONFIRM_CANDIDATE", id });
  assert.equal(s.candidates[0].status, "confirmed");
});

// Test 12: SET_PROCESSING toggles isProcessing
test("SET_PROCESSING toggles isProcessing", () => {
  const s1 = dispatch(INITIAL_VOICE_SESSION, { type: "SET_PROCESSING", value: true });
  assert.equal(s1.isProcessing, true);
  const s2 = dispatch(s1, { type: "SET_PROCESSING", value: false });
  assert.equal(s2.isProcessing, false);
});

// Test 13: SET_LISTENING toggles isListening
test("SET_LISTENING toggles isListening", () => {
  const s1 = dispatch(INITIAL_VOICE_SESSION, { type: "SET_LISTENING", value: true });
  assert.equal(s1.isListening, true);
  const s2 = dispatch(s1, { type: "SET_LISTENING", value: false });
  assert.equal(s2.isListening, false);
});

// Test 14: SET_QUOTA_EXHAUSTED sets quotaExhausted flag
test("SET_QUOTA_EXHAUSTED sets quotaExhausted to true", () => {
  const s = dispatch(INITIAL_VOICE_SESSION, { type: "SET_QUOTA_EXHAUSTED" });
  assert.equal(s.quotaExhausted, true);
});

// Test 15: RESET returns initial state
test("RESET clears all state back to INITIAL_VOICE_SESSION", () => {
  let s = dispatch(INITIAL_VOICE_SESSION, { type: "SET_LISTENING", value: true });
  s = dispatch(s, { type: "COMMIT_TRANSCRIPT", text: "some transcript" });
  s = dispatch(s, {
    type: "APPLY_OPERATIONS",
    operations: [{ type: "create_task", title: "Task A" }],
  });
  s = dispatch(s, { type: "SET_QUOTA_EXHAUSTED" });
  const reset = dispatch(s, { type: "RESET" });
  assert.deepEqual(reset, INITIAL_VOICE_SESSION);
});

// Test 16: Multiple sequential operations applied in order
test("APPLY_OPERATIONS applies multiple operations in sequence within one action", () => {
  const state = dispatch(INITIAL_VOICE_SESSION, {
    type: "APPLY_OPERATIONS",
    operations: [
      { type: "create_task", title: "Task A" },
      { type: "create_task", title: "Task B" },
      { type: "create_task", title: "Task C" },
      { type: "delete_task", targetRef: "last_task" }, // deletes Task C
    ],
  });
  assert.equal(state.candidates.length, 3);
  assert.equal(state.candidates[0].title, "Task A");
  assert.equal(state.candidates[0].status, "draft");
  assert.equal(state.candidates[1].title, "Task B");
  assert.equal(state.candidates[1].status, "draft");
  assert.equal(state.candidates[2].title, "Task C");
  assert.equal(state.candidates[2].status, "dismissed");
});

// Test 17: update_task change to title
test("APPLY_OPERATIONS update_task with title change updates the title of the last candidate", () => {
  let s = dispatch(INITIAL_VOICE_SESSION, {
    type: "APPLY_OPERATIONS",
    operations: [{ type: "create_task", title: "dentist appointment" }],
  });
  s = dispatch(s, {
    type: "APPLY_OPERATIONS",
    operations: [{ type: "update_task", targetRef: "last_task", changes: { title: "Call dentist" } }],
  });
  assert.equal(s.candidates[0].title, "Call dentist");
});
