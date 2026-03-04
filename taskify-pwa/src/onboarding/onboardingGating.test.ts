/**
 * Onboarding gating logic tests.
 *
 * Validates the state logic that determines when the Welcome/Login overlay
 * should be shown and, critically, that background app content must be gated
 * (inert) while any onboarding modal is active.
 *
 * These tests are self-contained (no Vite/React imports) and mirror the
 * logic in App.tsx that drives showFirstRunOnboarding / showAgentModeOnboarding
 * and the derived isOnboardingActive gate.
 */
import test from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Inline mirror of the gating logic from App.tsx
// ---------------------------------------------------------------------------

const LS_NOSTR_SK = "nostr_sk";
const LS_FIRST_RUN_ONBOARDING_DONE = "taskify_onboarding_done_v1";
const LS_AGENT_MODE_ONBOARDING_DONE = "taskify_agent_onboarding_done_v1";

function makeStorage(entries: Record<string, string> = {}): { getItem: (k: string) => string | null } {
  return { getItem: (k: string) => entries[k] ?? null };
}

function onboardingNeedsKeySelection(storage: ReturnType<typeof makeStorage>): boolean {
  try {
    const raw = (storage.getItem(LS_NOSTR_SK) || "").trim();
    return !/^[0-9a-fA-F]{64}$/.test(raw);
  } catch {
    return true;
  }
}

function computeShowFirstRunOnboarding(
  storage: ReturnType<typeof makeStorage>,
  agentSessionEnabled: boolean,
): boolean {
  if (agentSessionEnabled) return false;
  if (!onboardingNeedsKeySelection(storage)) return false;
  try {
    return storage.getItem(LS_FIRST_RUN_ONBOARDING_DONE) !== "done";
  } catch {
    return true;
  }
}

function computeShowAgentModeOnboarding(
  storage: ReturnType<typeof makeStorage>,
  agentSessionEnabled: boolean,
): boolean {
  if (!agentSessionEnabled) return false;
  try {
    return storage.getItem(LS_AGENT_MODE_ONBOARDING_DONE) !== "done";
  } catch {
    return true;
  }
}

/** Mirrors the isOnboardingActive derived value added in App.tsx */
function computeIsOnboardingActive(
  storage: ReturnType<typeof makeStorage>,
  agentSessionEnabled: boolean,
): boolean {
  return (
    computeShowFirstRunOnboarding(storage, agentSessionEnabled) ||
    computeShowAgentModeOnboarding(storage, agentSessionEnabled)
  );
}

const VALID_SK = "a".repeat(64); // 64 hex chars

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("showFirstRunOnboarding: true for fresh install (no SK, no done flag)", () => {
  const storage = makeStorage({});
  assert.equal(
    computeShowFirstRunOnboarding(storage, false),
    true,
    "Fresh install with no SK should show first-run onboarding",
  );
});

test("showFirstRunOnboarding: false when valid SK already exists", () => {
  const storage = makeStorage({ [LS_NOSTR_SK]: VALID_SK });
  assert.equal(
    computeShowFirstRunOnboarding(storage, false),
    false,
    "User with a valid SK is past onboarding; should not show",
  );
});

test("showFirstRunOnboarding: false when onboarding marked done (even without SK)", () => {
  // The done flag is the final gate: once the user has explicitly completed
  // onboarding (e.g. chose to continue without a key), the overlay stays dismissed.
  const storage = makeStorage({ [LS_FIRST_RUN_ONBOARDING_DONE]: "done" });
  assert.equal(
    computeShowFirstRunOnboarding(storage, false),
    false,
    "Done flag dismisses onboarding regardless of SK presence",
  );
});

test("showFirstRunOnboarding: false when agentSessionEnabled", () => {
  const storage = makeStorage({});
  assert.equal(
    computeShowFirstRunOnboarding(storage, true),
    false,
    "Agent sessions bypass first-run onboarding",
  );
});

test("showAgentModeOnboarding: true for first agent session without done flag", () => {
  const storage = makeStorage({});
  assert.equal(
    computeShowAgentModeOnboarding(storage, true),
    true,
    "First agent session without done flag should show agent onboarding",
  );
});

test("showAgentModeOnboarding: false when done flag set", () => {
  const storage = makeStorage({ [LS_AGENT_MODE_ONBOARDING_DONE]: "done" });
  assert.equal(
    computeShowAgentModeOnboarding(storage, true),
    false,
    "Completed agent onboarding should not show again",
  );
});

test("showAgentModeOnboarding: false when not an agent session", () => {
  const storage = makeStorage({});
  assert.equal(
    computeShowAgentModeOnboarding(storage, false),
    false,
    "Non-agent session must never show agent onboarding",
  );
});

test("isOnboardingActive: true gates background when first-run onboarding is shown", () => {
  const storage = makeStorage({});
  const active = computeIsOnboardingActive(storage, false);
  assert.equal(
    active,
    true,
    "isOnboardingActive must be true (inert gate required) during first-run onboarding",
  );
});

test("isOnboardingActive: true gates background when agent onboarding is shown", () => {
  const storage = makeStorage({});
  const active = computeIsOnboardingActive(storage, true);
  assert.equal(
    active,
    true,
    "isOnboardingActive must be true (inert gate required) during agent-mode onboarding",
  );
});

test("isOnboardingActive: false when user has valid SK (app mode, no gating needed)", () => {
  const storage = makeStorage({ [LS_NOSTR_SK]: VALID_SK });
  const active = computeIsOnboardingActive(storage, false);
  assert.equal(
    active,
    false,
    "isOnboardingActive must be false once user is past onboarding; tab bar must be interactive",
  );
});

test("isOnboardingActive: false after agent onboarding is completed", () => {
  const storage = makeStorage({ [LS_AGENT_MODE_ONBOARDING_DONE]: "done" });
  const active = computeIsOnboardingActive(storage, true);
  assert.equal(
    active,
    false,
    "isOnboardingActive must be false after agent onboarding is done; tab bar must be interactive",
  );
});

test("first-run and agent onboarding are mutually exclusive", () => {
  const storageNoSk = makeStorage({});
  const firstRun = computeShowFirstRunOnboarding(storageNoSk, false);
  const agentForSameSession = computeShowAgentModeOnboarding(storageNoSk, false);
  assert.equal(firstRun, true);
  assert.equal(agentForSameSession, false, "Agent onboarding must not show in non-agent session");

  const agentOnly = computeShowAgentModeOnboarding(storageNoSk, true);
  const firstRunForAgent = computeShowFirstRunOnboarding(storageNoSk, true);
  assert.equal(agentOnly, true);
  assert.equal(firstRunForAgent, false, "First-run onboarding must not show in agent session");
});
