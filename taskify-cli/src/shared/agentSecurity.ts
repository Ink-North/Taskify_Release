// CLI-adapted version of agentSecurity.ts (browser storage removed)

export type AgentSecurityMode = "off" | "moderate" | "strict";
export type AgentProvenance = "trusted" | "untrusted" | "unknown";

export type AgentSecurityConfig = {
  enabled: boolean;
  mode: AgentSecurityMode;
  trustedNpubs: string[];
  updatedISO: string;
};

export type AgentTrustAnnotated = {
  createdByNpub: string | null;
  lastEditedByNpub: string | null;
  provenance: AgentProvenance;
  trusted: boolean;
  agentSafe: boolean;
};

export type AgentTrustCounts = {
  trusted: number;
  untrusted: number;
  unknown: number;
  returned: number;
};

export type AgentSecurityStore = {
  get(): AgentSecurityConfig;
  set(config: AgentSecurityConfig): AgentSecurityConfig;
};

export const AGENT_SECURITY_STORAGE_KEY = "taskify.agent.security.v1";

function nowISO(): string {
  return new Date().toISOString();
}

export function defaultAgentSecurityConfig(): AgentSecurityConfig {
  return {
    enabled: true,
    mode: "moderate",
    trustedNpubs: [],
    updatedISO: nowISO(),
  };
}

function normalizeMode(value: unknown): AgentSecurityMode {
  return value === "strict" || value === "off" ? value : "moderate";
}

function normalizeTrustedNpub(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  return trimmed;
}

export function isLooselyValidTrustedNpub(value: unknown): boolean {
  return typeof value === "string" && value.trim().toLowerCase().startsWith("npub1") && value.trim().length > 10;
}

function normalizeTrustedNpubList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const deduped = new Map<string, string>();
  for (const entry of value) {
    const normalized = normalizeTrustedNpub(entry);
    if (!normalized) continue;
    deduped.set(normalized, normalized);
  }
  return Array.from(deduped.values()).sort();
}

export function normalizeAgentSecurityConfig(raw: unknown): AgentSecurityConfig {
  const fallback = defaultAgentSecurityConfig();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fallback;
  const candidate = raw as Partial<AgentSecurityConfig>;
  const updatedISO =
    typeof candidate.updatedISO === "string" && !Number.isNaN(Date.parse(candidate.updatedISO))
      ? new Date(candidate.updatedISO).toISOString()
      : fallback.updatedISO;
  return {
    enabled: candidate.enabled === true,
    mode: normalizeMode(candidate.mode),
    trustedNpubs: normalizeTrustedNpubList(candidate.trustedNpubs),
    updatedISO,
  };
}

// In-memory store for CLI use (config.ts provides persistence)
const inMemoryStore: { config: AgentSecurityConfig | null } = { config: null };

const defaultStore: AgentSecurityStore = {
  get() {
    return inMemoryStore.config ?? defaultAgentSecurityConfig();
  },
  set(config: AgentSecurityConfig) {
    const normalized = normalizeAgentSecurityConfig(config);
    inMemoryStore.config = normalized;
    return normalized;
  },
};

let currentAgentSecurityStore: AgentSecurityStore = defaultStore;

export function getAgentSecurityStore(): AgentSecurityStore {
  return currentAgentSecurityStore;
}

export function setAgentSecurityStore(store: AgentSecurityStore | null | undefined): void {
  currentAgentSecurityStore = store ?? defaultStore;
}

export function loadAgentSecurityConfig(): AgentSecurityConfig {
  return currentAgentSecurityStore.get();
}

export function saveAgentSecurityConfig(config: AgentSecurityConfig): AgentSecurityConfig {
  return currentAgentSecurityStore.set(config);
}

export function updateAgentSecurityConfig(
  updates: Partial<Pick<AgentSecurityConfig, "enabled" | "mode" | "trustedNpubs">>,
): AgentSecurityConfig {
  const current = loadAgentSecurityConfig();
  return saveAgentSecurityConfig({
    enabled: typeof updates.enabled === "boolean" ? updates.enabled : current.enabled,
    mode: updates.mode ? normalizeMode(updates.mode) : current.mode,
    trustedNpubs:
      updates.trustedNpubs !== undefined
        ? normalizeTrustedNpubList(updates.trustedNpubs)
        : current.trustedNpubs,
    updatedISO: nowISO(),
  });
}

export function addTrustedNpub(config: AgentSecurityConfig, npub: string): AgentSecurityConfig {
  const normalized = normalizeTrustedNpub(npub);
  if (!normalized) return normalizeAgentSecurityConfig(config);
  return normalizeAgentSecurityConfig({
    ...config,
    trustedNpubs: Array.from(new Set([...config.trustedNpubs.map((entry) => entry.toLowerCase()), normalized])),
    updatedISO: nowISO(),
  });
}

export function removeTrustedNpub(config: AgentSecurityConfig, npub: string): AgentSecurityConfig {
  const normalized = normalizeTrustedNpub(npub);
  return normalizeAgentSecurityConfig({
    ...config,
    trustedNpubs: config.trustedNpubs.filter((entry) => entry.toLowerCase() !== normalized),
    updatedISO: nowISO(),
  });
}

export function clearTrustedNpubs(config: AgentSecurityConfig): AgentSecurityConfig {
  return normalizeAgentSecurityConfig({
    ...config,
    trustedNpubs: [],
    updatedISO: nowISO(),
  });
}

export function getEffectiveAgentSecurityMode(config: AgentSecurityConfig): AgentSecurityMode {
  if (!config.enabled) return "off";
  return normalizeMode(config.mode);
}

function classifyProvenance(
  createdByNpub: string | null,
  lastEditedByNpub: string | null,
  config: AgentSecurityConfig,
): AgentProvenance {
  const trustedNpubs = new Set(config.trustedNpubs.map((entry) => entry.toLowerCase()));
  const normalizedLastEditedBy = normalizeTrustedNpub(lastEditedByNpub);
  const normalizedCreatedBy = normalizeTrustedNpub(createdByNpub);

  if (normalizedLastEditedBy && trustedNpubs.has(normalizedLastEditedBy)) {
    return "trusted";
  }
  if (!normalizedLastEditedBy && !normalizedCreatedBy) {
    return "unknown";
  }
  return "untrusted";
}

export function annotateTrust<T extends { createdByNpub?: string | null; lastEditedByNpub?: string | null }>(
  item: T,
  config: AgentSecurityConfig,
): T & AgentTrustAnnotated {
  const createdByNpub = normalizeTrustedNpub(item.createdByNpub) ?? null;
  const lastEditedByNpub = normalizeTrustedNpub(item.lastEditedByNpub) ?? null;
  const provenance = classifyProvenance(createdByNpub, lastEditedByNpub, config);
  const trusted = provenance === "trusted";
  return {
    ...item,
    createdByNpub,
    lastEditedByNpub,
    provenance,
    trusted,
    agentSafe: trusted,
  };
}

export function applyTrustFilter<T extends { createdByNpub?: string | null; lastEditedByNpub?: string | null }>(
  items: T[],
  config: AgentSecurityConfig,
): (T & AgentTrustAnnotated)[] {
  const annotated = items.map((item) => annotateTrust(item, config));
  if (getEffectiveAgentSecurityMode(config) === "strict") {
    return annotated.filter((item) => item.trusted);
  }
  return annotated;
}

export function summarizeTrustCounts<T extends { provenance: AgentProvenance }>(
  allItems: T[],
  returnedCount: number,
): AgentTrustCounts {
  return {
    trusted: allItems.filter((item) => item.provenance === "trusted").length,
    untrusted: allItems.filter((item) => item.provenance === "untrusted").length,
    unknown: allItems.filter((item) => item.provenance === "unknown").length,
    returned: returnedCount,
  };
}
