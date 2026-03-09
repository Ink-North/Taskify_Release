// Task cache for fast completions and repeated list calls.
// Cache file: ~/.config/taskify/cache.json

import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export const CACHE_DIR = join(homedir(), ".config", "taskify");
export const CACHE_PATH = join(CACHE_DIR, "cache.json");
export const CACHE_TTL_MS = 300_000; // 5 minutes

export type CachedTask = {
  id: string;
  title: string;
  boardId: string;
  boardName?: string;
  status: string; // "open" | "done" | "deleted"
  updatedAt?: number; // unix seconds
  // Extended fields (mirrors FullTaskRecord for round-trip fidelity)
  note?: string;
  dueISO?: string;
  dueDateEnabled?: boolean;
  dueTimeEnabled?: boolean;
  priority?: 1 | 2 | 3;
  completed?: boolean;
  completedAt?: string;
  createdAt?: number;
  createdBy?: string;
  lastEditedBy?: string;
  column?: string;
  subtasks?: Array<{ id: string; title: string; completed: boolean }>;
  recurrence?: unknown;
  bounty?: object;
  reminders?: string[];
};

export type BoardCache = {
  tasks: CachedTask[];
  fetchedAt: number;
};

export type TaskCache = {
  boards: Record<string, BoardCache>;
};

export function readCache(): TaskCache {
  try {
    const raw = readFileSync(CACHE_PATH, "utf-8");
    return JSON.parse(raw) as TaskCache;
  } catch {
    return { boards: {} };
  }
}

export function writeCache(cache: TaskCache): void {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), "utf-8");
  } catch {
    // Non-fatal: cache writes are best-effort
  }
}

export function clearCache(): void {
  try {
    unlinkSync(CACHE_PATH);
  } catch {
    // Non-fatal if already missing
  }
}

export function isCacheFresh(boardCache: BoardCache): boolean {
  return Date.now() - boardCache.fetchedAt < CACHE_TTL_MS;
}

/** Read open task IDs from cache synchronously for shell completions. */
export function readCachedOpenTaskIds(): Array<{ id: string; title: string }> {
  try {
    const raw = readFileSync(CACHE_PATH, "utf-8");
    const cache = JSON.parse(raw) as TaskCache;
    const now = Date.now();
    const results: Array<{ id: string; title: string }> = [];
    for (const boardCache of Object.values(cache.boards ?? {})) {
      if (now - boardCache.fetchedAt > CACHE_TTL_MS) continue;
      for (const task of boardCache.tasks ?? []) {
        if (task.status === "open") {
          results.push({ id: task.id.slice(0, 8), title: task.title });
        }
      }
    }
    return results;
  } catch {
    return [];
  }
}
