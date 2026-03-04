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

// ---------------------------------------------------------------------------
// Hard nav-guard tests
// These mirror the isOnboardingActiveRef guard added to navigation callbacks
// and the snap-back useEffect in App.tsx.
// ---------------------------------------------------------------------------

type ActivePage = "boards" | "upcoming" | "wallet" | "wallet-bounties" | "contacts" | "settings";

/** Mirrors the guarded setActivePage logic: returns new page or current if gated. */
function guardedNavigate(
  isOnboardingActive: boolean,
  currentPage: ActivePage,
  requestedPage: ActivePage,
): ActivePage {
  if (isOnboardingActive) return currentPage; // guard blocks the change
  return requestedPage;
}

/** Mirrors the snap-back useEffect: forces "boards" when onboarding is active. */
function snapBackActivePage(isOnboardingActive: boolean, activePage: ActivePage): ActivePage {
  if (isOnboardingActive && activePage !== "boards") return "boards";
  return activePage;
}

test("nav-guard: navigation to 'settings' is blocked while onboarding active", () => {
  const active = computeIsOnboardingActive(makeStorage({}), false);
  assert.equal(active, true);
  const result = guardedNavigate(active, "boards", "settings");
  assert.equal(result, "boards", "openSettings must be a no-op while onboarding is active");
});

test("nav-guard: navigation to 'upcoming' is blocked while onboarding active", () => {
  const active = computeIsOnboardingActive(makeStorage({}), false);
  const result = guardedNavigate(active, "boards", "upcoming");
  assert.equal(result, "boards", "openUpcoming must be a no-op while onboarding is active");
});

test("nav-guard: navigation to 'wallet' is blocked while onboarding active", () => {
  const active = computeIsOnboardingActive(makeStorage({}), false);
  const result = guardedNavigate(active, "boards", "wallet");
  assert.equal(result, "boards", "openWallet must be a no-op while onboarding is active");
});

test("nav-guard: navigation to 'contacts' is blocked while onboarding active", () => {
  const active = computeIsOnboardingActive(makeStorage({}), false);
  const result = guardedNavigate(active, "boards", "contacts");
  assert.equal(result, "boards", "openContactsPage must be a no-op while onboarding is active");
});

test("nav-guard: navigation is allowed after onboarding completes", () => {
  const storage = makeStorage({ [LS_NOSTR_SK]: VALID_SK });
  const active = computeIsOnboardingActive(storage, false);
  assert.equal(active, false, "Onboarding should be inactive with a valid SK");
  const result = guardedNavigate(active, "boards", "settings");
  assert.equal(result, "settings", "Navigation must proceed when onboarding is not active");
});

test("snap-back: activePage forced to 'boards' when onboarding becomes active", () => {
  // Simulate state where activePage drifted to "settings" (e.g. from a prior session)
  const result = snapBackActivePage(true, "settings");
  assert.equal(result, "boards", "Snap-back must reset activePage to 'boards' while onboarding is active");
});

test("snap-back: activePage forced to 'boards' from any non-boards page", () => {
  const pages: ActivePage[] = ["upcoming", "wallet", "wallet-bounties", "contacts", "settings"];
  for (const page of pages) {
    const result = snapBackActivePage(true, page);
    assert.equal(result, "boards", `Snap-back must reset '${page}' to 'boards' during onboarding`);
  }
});

test("snap-back: activePage unchanged when already 'boards' during onboarding", () => {
  const result = snapBackActivePage(true, "boards");
  assert.equal(result, "boards", "No unnecessary state change when already on 'boards'");
});

test("snap-back: activePage unchanged when onboarding is not active", () => {
  const result = snapBackActivePage(false, "settings");
  assert.equal(result, "settings", "Snap-back must not interfere after onboarding completes");
});

test("startup-view guard: startupView redirect is skipped while onboarding active", () => {
  // Mirror the guarded startup-view effect logic
  function applyStartupView(
    isOnboardingActive: boolean,
    startupView: string | undefined,
    currentPage: ActivePage,
  ): ActivePage {
    if (isOnboardingActive) return currentPage; // guard skips redirect
    if (startupView === "wallet") return "wallet";
    return currentPage;
  }

  const activeStorage = makeStorage({}); // fresh install, no SK
  const active = computeIsOnboardingActive(activeStorage, false);
  assert.equal(active, true);
  const result = applyStartupView(active, "wallet", "boards");
  assert.equal(result, "boards", "startupView='wallet' redirect must be skipped while onboarding is active");
});

test("startup-view guard: startupView redirect proceeds once onboarding done", () => {
  function applyStartupView(
    isOnboardingActive: boolean,
    startupView: string | undefined,
    currentPage: ActivePage,
  ): ActivePage {
    if (isOnboardingActive) return currentPage;
    if (startupView === "wallet") return "wallet";
    return currentPage;
  }

  const doneStorage = makeStorage({ [LS_NOSTR_SK]: VALID_SK });
  const active = computeIsOnboardingActive(doneStorage, false);
  assert.equal(active, false);
  const result = applyStartupView(active, "wallet", "boards");
  assert.equal(result, "wallet", "startupView redirect must proceed when onboarding is done");
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
