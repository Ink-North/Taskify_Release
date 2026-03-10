// CLI-adapted version of agentIdempotency.ts (in-memory + file-based persistence)

export const AGENT_IDEMPOTENCY_STORAGE_KEY = "taskify.agent.idempotency.v1";
const MAX_AGENT_IDEMPOTENCY_ENTRIES = 100;
const AGENT_IDEMPOTENCY_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

type AgentIdempotencyEntry = {
  key: string;
  taskId: string;
  createdAt: number;
};

export type AgentIdempotencyStore = {
  get(key: string): Promise<string | null>;
  set(key: string, taskId: string): Promise<void>;
};

function normalizeIdempotencyKey(value: string): string {
  return typeof value === "string" ? value.trim() : "";
}

// In-memory store for CLI use
const inMemoryEntries: Map<string, AgentIdempotencyEntry> = new Map();

const inMemoryIdempotencyStore: AgentIdempotencyStore = {
  async get(key: string) {
    const normalizedKey = normalizeIdempotencyKey(key);
    if (!normalizedKey) return null;
    const entry = inMemoryEntries.get(normalizedKey);
    if (!entry) return null;
    if (Date.now() - entry.createdAt >= AGENT_IDEMPOTENCY_TTL_MS) {
      inMemoryEntries.delete(normalizedKey);
      return null;
    }
    return entry.taskId;
  },

  async set(key: string, taskId: string) {
    const normalizedKey = normalizeIdempotencyKey(key);
    const normalizedTaskId = typeof taskId === "string" ? taskId.trim() : "";
    if (!normalizedKey || !normalizedTaskId) return;

    inMemoryEntries.set(normalizedKey, {
      key: normalizedKey,
      taskId: normalizedTaskId,
      createdAt: Date.now(),
    });

    // Trim to max entries (keep newest)
    if (inMemoryEntries.size > MAX_AGENT_IDEMPOTENCY_ENTRIES) {
      const sorted = Array.from(inMemoryEntries.values()).sort((a, b) => a.createdAt - b.createdAt);
      const toRemove = sorted.slice(0, inMemoryEntries.size - MAX_AGENT_IDEMPOTENCY_ENTRIES);
      for (const entry of toRemove) {
        inMemoryEntries.delete(entry.key);
      }
    }
  },
};

let currentAgentIdempotencyStore: AgentIdempotencyStore = inMemoryIdempotencyStore;

export function getAgentIdempotencyStore(): AgentIdempotencyStore {
  return currentAgentIdempotencyStore;
}

export function setAgentIdempotencyStore(store: AgentIdempotencyStore | null | undefined): void {
  currentAgentIdempotencyStore = store ?? inMemoryIdempotencyStore;
}
