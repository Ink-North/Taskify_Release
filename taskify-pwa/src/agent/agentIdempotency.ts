import { idbKeyValue } from "../storage/idbKeyValue.ts";
import { TASKIFY_STORE_TASKS } from "../storage/taskifyDb.ts";

export const AGENT_IDEMPOTENCY_STORAGE_KEY = "taskify.agent.idempotency.v1";
const MAX_AGENT_IDEMPOTENCY_ENTRIES = 100;

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

function readEntries(): AgentIdempotencyEntry[] {
  try {
    const raw = idbKeyValue.getItem(TASKIFY_STORE_TASKS, AGENT_IDEMPOTENCY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry) => entry && typeof entry === "object")
      .map((entry) => ({
        key: normalizeIdempotencyKey(typeof entry.key === "string" ? entry.key : ""),
        taskId: typeof entry.taskId === "string" ? entry.taskId.trim() : "",
        createdAt:
          typeof entry.createdAt === "number" && Number.isFinite(entry.createdAt)
            ? entry.createdAt
            : 0,
      }))
      .filter((entry) => entry.key && entry.taskId)
      .sort((left, right) => left.createdAt - right.createdAt)
      .slice(-MAX_AGENT_IDEMPOTENCY_ENTRIES);
  } catch {
    return [];
  }
}

function writeEntries(entries: AgentIdempotencyEntry[]): void {
  try {
    idbKeyValue.setItem(
      TASKIFY_STORE_TASKS,
      AGENT_IDEMPOTENCY_STORAGE_KEY,
      JSON.stringify(
        entries
          .filter((entry) => entry.key && entry.taskId)
          .sort((left, right) => left.createdAt - right.createdAt)
          .slice(-MAX_AGENT_IDEMPOTENCY_ENTRIES),
      ),
    );
  } catch {}
}

const persistentAgentIdempotencyStore: AgentIdempotencyStore = {
  async get(key: string) {
    const normalizedKey = normalizeIdempotencyKey(key);
    if (!normalizedKey) return null;
    const match = readEntries().find((entry) => entry.key === normalizedKey);
    return match?.taskId ?? null;
  },

  async set(key: string, taskId: string) {
    const normalizedKey = normalizeIdempotencyKey(key);
    const normalizedTaskId = typeof taskId === "string" ? taskId.trim() : "";
    if (!normalizedKey || !normalizedTaskId) return;

    const entries = readEntries().filter((entry) => entry.key !== normalizedKey);
    entries.push({
      key: normalizedKey,
      taskId: normalizedTaskId,
      createdAt: Date.now(),
    });
    writeEntries(entries);
  },
};

let currentAgentIdempotencyStore: AgentIdempotencyStore = persistentAgentIdempotencyStore;

export function getAgentIdempotencyStore(): AgentIdempotencyStore {
  return currentAgentIdempotencyStore;
}

export function setAgentIdempotencyStore(store: AgentIdempotencyStore | null | undefined): void {
  currentAgentIdempotencyStore = store ?? persistentAgentIdempotencyStore;
}
