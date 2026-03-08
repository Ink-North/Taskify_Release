import test from "node:test";
import assert from "node:assert/strict";
import {
  addTrustedNpub,
  annotateTrust,
  applyTrustFilter,
  clearTrustedNpubs,
  defaultAgentSecurityConfig,
  getEffectiveAgentSecurityMode,
  isLooselyValidTrustedNpub,
  normalizeAgentSecurityConfig,
  removeTrustedNpub,
  setAgentSecurityStore,
  summarizeTrustCounts,
  type AgentSecurityConfig,
} from "./agentSecurity.ts";

// Helpers

function makeConfig(overrides: Partial<AgentSecurityConfig> = {}): AgentSecurityConfig {
  return { ...defaultAgentSecurityConfig(), ...overrides };
}

const NPUB_A = "npub1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0xyz";
const NPUB_B = "npub1bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb0xyz";

// --- defaultAgentSecurityConfig ---

test("defaultAgentSecurityConfig returns enabled moderate with empty npubs", () => {
  const cfg = defaultAgentSecurityConfig();
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.mode, "moderate");
  assert.deepEqual(cfg.trustedNpubs, []);
});

// --- isLooselyValidTrustedNpub ---

test("isLooselyValidTrustedNpub accepts valid npub prefix", () => {
  assert.equal(isLooselyValidTrustedNpub("npub1f4t6089m5zhljvrurfuc8ceymlr6yzrdljxz9yaskyj8r8s536ns6rv35g"), true);
});

test("isLooselyValidTrustedNpub rejects short string", () => {
  assert.equal(isLooselyValidTrustedNpub("npub1"), false);
});

test("isLooselyValidTrustedNpub rejects wrong prefix", () => {
  assert.equal(isLooselyValidTrustedNpub("nsec1abc123"), false);
});

test("isLooselyValidTrustedNpub rejects non-string", () => {
  assert.equal(isLooselyValidTrustedNpub(42), false);
  assert.equal(isLooselyValidTrustedNpub(null), false);
});

// --- normalizeAgentSecurityConfig ---

test("normalizeAgentSecurityConfig returns default for null input", () => {
  const cfg = normalizeAgentSecurityConfig(null);
  assert.equal(cfg.mode, "moderate");
});

test("normalizeAgentSecurityConfig returns default for non-object", () => {
  const cfg = normalizeAgentSecurityConfig("bad");
  assert.equal(cfg.mode, "moderate");
});

test("normalizeAgentSecurityConfig clamps unknown mode to moderate", () => {
  const cfg = normalizeAgentSecurityConfig({ enabled: true, mode: "super-strict", trustedNpubs: [] });
  assert.equal(cfg.mode, "moderate");
});

test("normalizeAgentSecurityConfig deduplicates trustedNpubs (case-insensitive)", () => {
  const cfg = normalizeAgentSecurityConfig({
    enabled: true,
    mode: "moderate",
    trustedNpubs: [NPUB_A, NPUB_A.toUpperCase(), NPUB_B],
  });
  assert.equal(cfg.trustedNpubs.length, 2);
});

test("normalizeAgentSecurityConfig sorts trustedNpubs", () => {
  const cfg = normalizeAgentSecurityConfig({
    enabled: true,
    mode: "moderate",
    trustedNpubs: [NPUB_B, NPUB_A],
  });
  assert.equal(cfg.trustedNpubs[0], NPUB_A.toLowerCase());
  assert.equal(cfg.trustedNpubs[1], NPUB_B.toLowerCase());
});

// --- addTrustedNpub ---

test("addTrustedNpub adds new npub", () => {
  const before = makeConfig();
  const after = addTrustedNpub(before, NPUB_A);
  assert.ok(after.trustedNpubs.includes(NPUB_A.toLowerCase()));
});

test("addTrustedNpub deduplicates on repeated add", () => {
  let cfg = makeConfig();
  cfg = addTrustedNpub(cfg, NPUB_A);
  cfg = addTrustedNpub(cfg, NPUB_A);
  assert.equal(cfg.trustedNpubs.filter((n) => n === NPUB_A.toLowerCase()).length, 1);
});

test("addTrustedNpub is case-insensitive", () => {
  let cfg = makeConfig();
  cfg = addTrustedNpub(cfg, NPUB_A.toUpperCase());
  assert.ok(cfg.trustedNpubs.includes(NPUB_A.toLowerCase()));
});

// --- removeTrustedNpub ---

test("removeTrustedNpub removes existing npub", () => {
  let cfg = makeConfig({ trustedNpubs: [NPUB_A.toLowerCase()] });
  cfg = removeTrustedNpub(cfg, NPUB_A);
  assert.deepEqual(cfg.trustedNpubs, []);
});

test("removeTrustedNpub no-ops for missing npub", () => {
  const cfg = makeConfig({ trustedNpubs: [NPUB_B.toLowerCase()] });
  const result = removeTrustedNpub(cfg, NPUB_A);
  assert.deepEqual(result.trustedNpubs, [NPUB_B.toLowerCase()]);
});

// --- clearTrustedNpubs ---

test("clearTrustedNpubs empties the list", () => {
  const cfg = makeConfig({ trustedNpubs: [NPUB_A.toLowerCase(), NPUB_B.toLowerCase()] });
  const result = clearTrustedNpubs(cfg);
  assert.deepEqual(result.trustedNpubs, []);
});

// --- getEffectiveAgentSecurityMode ---

test("getEffectiveAgentSecurityMode returns off when disabled", () => {
  const cfg = makeConfig({ enabled: false, mode: "strict" });
  assert.equal(getEffectiveAgentSecurityMode(cfg), "off");
});

test("getEffectiveAgentSecurityMode returns mode when enabled", () => {
  assert.equal(getEffectiveAgentSecurityMode(makeConfig({ enabled: true, mode: "strict" })), "strict");
  assert.equal(getEffectiveAgentSecurityMode(makeConfig({ enabled: true, mode: "moderate" })), "moderate");
  assert.equal(getEffectiveAgentSecurityMode(makeConfig({ enabled: true, mode: "off" })), "off");
});

// --- annotateTrust ---

test("annotateTrust marks as trusted when lastEditedByNpub is in trustedNpubs", () => {
  const cfg = makeConfig({ enabled: true, mode: "moderate", trustedNpubs: [NPUB_A.toLowerCase()] });
  const item = { createdByNpub: null, lastEditedByNpub: NPUB_A };
  const result = annotateTrust(item, cfg);
  assert.equal(result.provenance, "trusted");
  assert.equal(result.trusted, true);
  assert.equal(result.agentSafe, true);
});

test("annotateTrust marks as untrusted when lastEditedByNpub is set but not trusted", () => {
  const cfg = makeConfig({ enabled: true, mode: "moderate", trustedNpubs: [NPUB_A.toLowerCase()] });
  const item = { createdByNpub: null, lastEditedByNpub: NPUB_B };
  const result = annotateTrust(item, cfg);
  assert.equal(result.provenance, "untrusted");
  assert.equal(result.trusted, false);
});

test("annotateTrust marks as unknown when no editor or creator", () => {
  const cfg = makeConfig();
  const item = { createdByNpub: null, lastEditedByNpub: null };
  const result = annotateTrust(item, cfg);
  assert.equal(result.provenance, "unknown");
  assert.equal(result.trusted, false);
});

test("annotateTrust is case-insensitive for npub comparison", () => {
  const cfg = makeConfig({ trustedNpubs: [NPUB_A.toLowerCase()] });
  const item = { createdByNpub: null, lastEditedByNpub: NPUB_A.toUpperCase() };
  const result = annotateTrust(item, cfg);
  assert.equal(result.provenance, "trusted");
});

// --- applyTrustFilter ---

test("applyTrustFilter in moderate mode returns all tasks annotated", () => {
  const cfg = makeConfig({ enabled: true, mode: "moderate", trustedNpubs: [NPUB_A.toLowerCase()] });
  const items = [
    { createdByNpub: null, lastEditedByNpub: NPUB_A },
    { createdByNpub: null, lastEditedByNpub: NPUB_B },
    { createdByNpub: null, lastEditedByNpub: null },
  ];
  const result = applyTrustFilter(items, cfg);
  assert.equal(result.length, 3);
});

test("applyTrustFilter in strict mode returns only trusted tasks", () => {
  const cfg = makeConfig({ enabled: true, mode: "strict", trustedNpubs: [NPUB_A.toLowerCase()] });
  const items = [
    { createdByNpub: null, lastEditedByNpub: NPUB_A },   // trusted
    { createdByNpub: null, lastEditedByNpub: NPUB_B },   // untrusted
    { createdByNpub: null, lastEditedByNpub: null },      // unknown
  ];
  const result = applyTrustFilter(items, cfg);
  assert.equal(result.length, 1);
  assert.equal(result[0].provenance, "trusted");
});

test("applyTrustFilter in off mode (disabled) returns all tasks", () => {
  const cfg = makeConfig({ enabled: false, mode: "strict", trustedNpubs: [NPUB_A.toLowerCase()] });
  const items = [
    { createdByNpub: null, lastEditedByNpub: NPUB_A },
    { createdByNpub: null, lastEditedByNpub: NPUB_B },
  ];
  // When disabled, effective mode is "off" — all returned
  const result = applyTrustFilter(items, cfg);
  assert.equal(result.length, 2);
});

// --- summarizeTrustCounts ---

test("summarizeTrustCounts tallies provenance correctly", () => {
  const items = [
    { provenance: "trusted" as const },
    { provenance: "trusted" as const },
    { provenance: "untrusted" as const },
    { provenance: "unknown" as const },
  ];
  const counts = summarizeTrustCounts(items, 2); // returned=2 after strict filter
  assert.equal(counts.trusted, 2);
  assert.equal(counts.untrusted, 1);
  assert.equal(counts.unknown, 1);
  assert.equal(counts.returned, 2);
});

// --- in-memory store injection ---

test("setAgentSecurityStore allows injecting a custom store", () => {
  let stored: AgentSecurityConfig | null = null;
  setAgentSecurityStore({
    get: () => defaultAgentSecurityConfig(),
    set: (cfg) => { stored = cfg; return cfg; },
  });
  // Reset to default persistent store after test
  setAgentSecurityStore(null);
  assert.equal(stored, null); // we didn't call set, just confirming no crash
});
