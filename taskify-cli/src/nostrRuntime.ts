import NDK, { NDKEvent, NDKPrivateKeySigner, NDKRelayStatus } from "@nostr-dev-kit/ndk";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { getPublicKey, nip19 } from "nostr-tools";
import type { ReminderPreset, Recurrence, Subtask } from "./shared/taskTypes.ts";
import type { AgentTaskCreateInput, AgentTaskPatchInput, AgentTaskStatus } from "./shared/agentRuntime.ts";
import type { AgentSecurityConfig } from "./shared/agentSecurity.ts";
import type { TaskifyConfig, BoardEntry } from "./config.ts";
import { saveConfig, loadConfig } from "./config.ts";
import { readCache, writeCache, isCacheFresh, type CachedTask } from "./taskCache.ts";

function nowISO(): string {
  return new Date().toISOString();
}

// ---- Internal helpers (not exported) ----

function boardTagHash(boardId: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(boardId)));
}

function deriveBoardKeys(boardId: string): {
  sk: Uint8Array;
  skHex: string;
  pk: string;
  signer: NDKPrivateKeySigner;
} {
  const label = new TextEncoder().encode("taskify-board-nostr-key-v1");
  const id = new TextEncoder().encode(boardId);
  const material = new Uint8Array(label.length + id.length);
  material.set(label, 0);
  material.set(id, label.length);
  const sk = sha256(material);
  const skHex = bytesToHex(sk);
  const pk = getPublicKey(sk);
  return { sk, skHex, pk, signer: new NDKPrivateKeySigner(skHex) };
}

async function deriveAESKey(boardId: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(boardId),
  );
  return crypto.subtle.importKey(
    "raw",
    digest,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

async function encryptContent(boardId: string, plaintext: string): Promise<string> {
  const key = await deriveAESKey(boardId);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const pt = new TextEncoder().encode(plaintext);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, pt);
  const result = new Uint8Array(12 + ct.byteLength);
  result.set(iv, 0);
  result.set(new Uint8Array(ct), 12);
  return Buffer.from(result).toString("base64");
}

async function decryptContent(boardId: string, data: string): Promise<string> {
  const key = await deriveAESKey(boardId);
  const bytes = Buffer.from(data, "base64");
  const iv = bytes.subarray(0, 12);
  const ct = bytes.subarray(12);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(pt);
}

function getUserPubkeyHex(config: TaskifyConfig): string | undefined {
  if (!config.nsec) return undefined;
  try {
    const decoded = nip19.decode(config.nsec);
    if (decoded.type === "nsec") {
      return getPublicKey(decoded.data as Uint8Array);
    }
  } catch {
    // ignore
  }
  return undefined;
}

function validateEventCompat(event: NDKEvent): boolean {
  if (event.kind !== 30301) return false;
  const hasD = event.tags.some((t) => t[0] === "d");
  const hasB = event.tags.some((t) => t[0] === "b");
  if (!hasD || !hasB) return false;
  if (!event.content) return false;
  return true;
}

function resolveBoardEntry(config: TaskifyConfig, boardIdOrName: string): BoardEntry | null {
  // Exact UUID match first
  let entry = config.boards.find((b) => b.id === boardIdOrName);
  if (entry) return entry;
  // Case-insensitive name match
  const lower = boardIdOrName.toLowerCase();
  entry = config.boards.find((b) => b.name.toLowerCase() === lower);
  return entry ?? null;
}

// ---- Cache conversion helpers ----

function recordToCache(r: FullTaskRecord): CachedTask {
  return {
    id: r.id,
    title: r.title,
    boardId: r.boardId,
    boardName: r.boardName,
    status: r.completed ? "done" : "open",
    updatedAt: r.createdAt,
    note: r.note,
    dueISO: r.dueISO,
    dueDateEnabled: r.dueDateEnabled,
    dueTimeEnabled: r.dueTimeEnabled,
    priority: r.priority,
    completed: r.completed,
    completedAt: r.completedAt,
    createdAt: r.createdAt,
    createdBy: r.createdBy,
    lastEditedBy: r.lastEditedBy,
    column: r.column,
    subtasks: r.subtasks as Array<{ id: string; title: string; completed: boolean }> | undefined,
    recurrence: r.recurrence,
    bounty: r.bounty,
    reminders: r.reminders as string[] | undefined,
    inboxItem: r.inboxItem,
    assignees: r.assignees,
  };
}

function cacheToRecord(t: CachedTask, boardName?: string): FullTaskRecord {
  return {
    id: t.id,
    boardId: t.boardId,
    boardName: t.boardName ?? boardName,
    title: t.title,
    note: t.note,
    dueISO: t.dueISO ?? "",
    dueDateEnabled: t.dueDateEnabled,
    dueTimeEnabled: t.dueTimeEnabled,
    priority: t.priority,
    completed: t.status === "done",
    completedAt: t.completedAt,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt
      ? new Date(t.updatedAt * 1000).toISOString()
      : undefined,
    createdBy: t.createdBy,
    lastEditedBy: t.lastEditedBy,
    column: t.column,
    subtasks: t.subtasks,
    recurrence: t.recurrence as Recurrence | undefined,
    bounty: t.bounty,
    reminders: t.reminders as ReminderPreset[] | undefined,
    inboxItem: t.inboxItem,
    assignees: t.assignees,
  };
}

// ---- Public types ----

export type FullTaskRecord = {
  id: string;              // UUID from the "d" tag
  boardId: string;         // raw board UUID
  boardName?: string;
  title: string;
  note?: string;
  dueISO: string;
  dueDateEnabled?: boolean;
  dueTimeEnabled?: boolean;
  priority?: 1 | 2 | 3;
  completed: boolean;
  completedAt?: string;
  createdAt?: number;      // Unix seconds (for render compat)
  updatedAt?: string;
  createdBy?: string;      // hex pubkey
  lastEditedBy?: string;   // hex pubkey
  recurrence?: Recurrence;
  subtasks?: Subtask[];
  bounty?: object;
  reminders?: ReminderPreset[];
  column?: string;         // col tag value (column ID)
  sourceBoardId?: string;
  inboxItem?: boolean;
  assignees?: string[];    // hex pubkeys
};

export type ExtendedCreateInput = AgentTaskCreateInput & {
  subtasks?: Subtask[];
  inboxItem?: boolean;
  assignees?: string[];
};

export type NostrRuntime = {
  getDefaultBoardId(): string | null;
  disconnect(): Promise<void>;
  listTasks(options: {
    boardId?: string;
    status: "open" | "done" | "any";
    columnId?: string;
    refresh?: boolean;
    noCache?: boolean;
  }): Promise<FullTaskRecord[]>;
  syncBoard(boardId: string): Promise<{ kind?: string; columns?: { id: string; name: string }[]; children?: string[] }>;
  createTask(input: AgentTaskCreateInput): Promise<FullTaskRecord>;
  createTaskFull(input: ExtendedCreateInput): Promise<FullTaskRecord>;
  createBoard(input: { name: string; kind: "lists" | "week"; columns?: { id: string; name: string }[] }): Promise<{ boardId: string }>;
  updateTask(taskId: string, boardId: string, patch: AgentTaskPatchInput): Promise<FullTaskRecord | null>;
  setTaskStatus(taskId: string, status: AgentTaskStatus, boardId: string): Promise<FullTaskRecord | null>;
  deleteTask(taskId: string, boardId: string): Promise<FullTaskRecord | null>;
  toggleSubtask(taskId: string, boardId: string, subtaskRef: string, completed: boolean): Promise<FullTaskRecord | null>;
  getTask(taskId: string, boardId?: string): Promise<FullTaskRecord | null>;
  remindTask(taskId: string, presets: ReminderPreset[]): Promise<void>;
  getLocalReminders(taskId: string): ReminderPreset[];
  getAgentSecurityConfig(): Promise<AgentSecurityConfig>;
  setAgentSecurityConfig(cfg: AgentSecurityConfig): Promise<AgentSecurityConfig>;
  getRelayStatus(): Promise<{ url: string; connected: boolean }[]>;
};

// ---- Event parsing ----

async function parseDecryptedEvent(
  event: NDKEvent,
  boardId: string,
  boardName?: string,
): Promise<FullTaskRecord | null> {
  if (!validateEventCompat(event)) return null;
  try {
    const plaintext = await decryptContent(boardId, event.content);
    const payload = JSON.parse(plaintext);
    const dTag = event.tags.find((t) => t[0] === "d");
    const taskId = dTag?.[1] ?? "";
    if (!taskId) return null;
    const statusTag = event.tags.find((t) => t[0] === "status");
    const statusVal = statusTag?.[1] ?? "open";
    const completed = statusVal === "done";
    const colTag = event.tags.find((t) => t[0] === "col");
    const column = colTag?.[1] || undefined;
    return {
      id: taskId,
      boardId,
      boardName,
      title: payload.title ?? "",
      note: payload.note || undefined,
      dueISO: payload.dueISO ?? "",
      dueDateEnabled: payload.dueDateEnabled ?? undefined,
      dueTimeEnabled: payload.dueTimeEnabled ?? undefined,
      priority: payload.priority ?? undefined,
      completed,
      completedAt: payload.completedAt ?? undefined,
      // payload.createdAt is ms; convert to seconds for render compat
      createdAt: payload.createdAt
        ? Math.floor(payload.createdAt / 1000)
        : event.created_at,
      updatedAt: event.created_at
        ? new Date(event.created_at * 1000).toISOString()
        : undefined,
      createdBy: payload.createdBy,
      lastEditedBy: payload.lastEditedBy,
      recurrence: payload.recurrence ?? undefined,
      subtasks: payload.subtasks ?? undefined,
      bounty: payload.bounty ?? undefined,
      column,
      inboxItem: payload.inboxItem === true ? true : undefined,
      assignees: Array.isArray(payload.assignees) && payload.assignees.length > 0
        ? (payload.assignees as Array<unknown>).map((a) =>
            typeof a === "string" ? a : (a as Record<string, string>).pubkey ?? "")
          .filter(Boolean)
        : undefined,
    };
  } catch {
    return null;
  }
}

// ---- Runtime factory ----

export function createNostrRuntime(config: TaskifyConfig): NostrRuntime {
  const ndk = new NDK({
    explicitRelayUrls: config.relays,
  });

  let connected = false;

  async function ensureConnected(): Promise<void> {
    if (!connected) {
      await Promise.race([
        ndk.connect(),
        new Promise<void>((resolve) =>
          setTimeout(() => {
            process.stderr.write(
              "⚠ Relay connection slow — continuing with available relays\n",
            );
            resolve();
          }, 8000),
        ),
      ]);
      connected = true;
    }
  }

  async function fetchBoardEvents(boardId: string, taskId?: string): Promise<Set<NDKEvent>> {
    const bTag = boardTagHash(boardId);
    const filter: Record<string, unknown> = {
      kinds: [30301],
      "#b": [bTag],
      limit: taskId ? undefined : 500,
    };
    if (taskId) filter["#d"] = [taskId];

    let hardTimer: ReturnType<typeof setTimeout>;

    return new Promise<Set<NDKEvent>>((resolve) => {
      const collected = new Set<NDKEvent>();
      let graceTimer: ReturnType<typeof setTimeout> | null = null;
      let settled = false;
      const HARD_TIMEOUT_MS = taskId ? 10_000 : 15_000;
      const EOSE_GRACE_MS = 200;

      const settle = () => {
        if (settled) return;
        settled = true;
        if (graceTimer) clearTimeout(graceTimer);
        if (hardTimer) clearTimeout(hardTimer);
        try { sub.stop(); } catch { /* ignore */ }
        resolve(collected);
      };

      hardTimer = setTimeout(settle, HARD_TIMEOUT_MS);

      const sub = ndk.subscribe(
        filter as Parameters<typeof ndk.subscribe>[0],
        { closeOnEose: false },
      );

      sub.on("event", (evt: NDKEvent) => {
        if (!settled) collected.add(evt);
      });

      sub.on("eose", () => {
        // First EOSE received — start grace window if not already started
        if (!graceTimer && !settled) {
          graceTimer = setTimeout(settle, EOSE_GRACE_MS);
        }
      });
    });
  }

  // Resolves a full UUID from a short prefix — fetches all board events and scans "d" tags.
  async function resolveTaskId(boardId: string, taskIdOrPrefix: string): Promise<string | null> {
    // Full UUID — use directly
    if (taskIdOrPrefix.length === 36) return taskIdOrPrefix;
    // Short prefix — scan board events
    const allEvents = await fetchBoardEvents(boardId);
    const prefix = taskIdOrPrefix.toLowerCase().slice(0, 8);
    for (const event of allEvents) {
      const dTag = event.tags.find((t) => t[0] === "d");
      const dVal = (dTag?.[1] ?? "").toLowerCase();
      if (dVal.startsWith(prefix)) return dTag![1];
    }
    return null;
  }

  async function publishTaskEvent(
    boardId: string,
    taskId: string,
    payload: Record<string, unknown>,
    status: "open" | "done" | "deleted",
    colId: string = "",
  ): Promise<NDKEvent> {
    const { signer } = deriveBoardKeys(boardId);
    const bTag = boardTagHash(boardId);
    const encrypted = await encryptContent(boardId, JSON.stringify(payload));
    const event = new NDKEvent(ndk);
    event.kind = 30301;
    event.content = encrypted;
    event.tags = [
      ["d", taskId],
      ["b", bTag],
      ["col", colId],
      ["status", status],
    ];
    await event.sign(signer);
    try {
      await event.publish();
    } catch (err) {
      throw new Error(
        `Publish failed — check relay connectivity (taskify relay status): ${String(err)}`,
      );
    }
    return event;
  }

  return {
    getDefaultBoardId(): string | null {
      return config.boards[0]?.id ?? null;
    },

    async disconnect(): Promise<void> {
      try {
        (ndk.pool as unknown as { destroy?(): void })?.destroy?.();
      } catch {
        // ignore teardown errors
      }
    },

    async listTasks({ boardId, status, columnId, refresh, noCache }): Promise<FullTaskRecord[]> {
      const boards: BoardEntry[] = [];
      if (boardId) {
        const entry = resolveBoardEntry(config, boardId);
        if (!entry) {
          throw new Error(
            `Board not found in config: "${boardId}". Use: taskify board join <id> --name <name>`,
          );
        }
        boards.push(entry);
      } else {
        boards.push(...config.boards);
      }
      if (boards.length === 0) return [];

      const cache = readCache();
      const records: FullTaskRecord[] = [];

      for (const board of boards) {
        // Compound board: aggregate tasks from children
        if (board.kind === "compound") {
          await ensureConnected();
          const childIds = board.children ?? [];
          const seen = new Set<string>();
          for (const childId of childIds) {
            const childEntry = resolveBoardEntry(config, childId) ?? { id: childId, name: childId };
            const childEvents = await fetchBoardEvents(childId);
            for (const event of childEvents) {
              const record = await parseDecryptedEvent(event, childId, (childEntry as BoardEntry).name ?? childId);
              if (!record) continue;
              if (seen.has(record.id)) continue;
              seen.add(record.id);
              record.sourceBoardId = childId;
              if (status === "open" && record.completed) continue;
              if (status === "done" && !record.completed) continue;
              if (columnId !== undefined && record.column !== columnId) continue;
              records.push(record);
            }
          }
          continue;
        }

        const boardCache = cache.boards[board.id];

        // Use cache if fresh and not forcing a refresh
        if (!refresh && boardCache && isCacheFresh(boardCache)) {
          for (const t of boardCache.tasks) {
            const rec = cacheToRecord(t, board.name);
            if (status === "open" && rec.completed) continue;
            if (status === "done" && !rec.completed) continue;
            if (columnId !== undefined && rec.column !== columnId) continue;
            records.push(rec);
          }
          continue;
        }

        // Fetch live from relay
        await ensureConnected();
        const events = await fetchBoardEvents(board.id);
        const liveRecords: FullTaskRecord[] = [];
        for (const event of events) {
          const record = await parseDecryptedEvent(event, board.id, board.name);
          if (!record) continue;
          liveRecords.push(record);
        }

        // A3/A2: guard against caching an empty result when previous data exists
        if (liveRecords.length === 0 && boardCache && !noCache) {
          const cacheAgeMs = Date.now() - boardCache.fetchedAt;
          const TEN_MIN_MS = 10 * 60 * 1000;
          if (cacheAgeMs <= TEN_MIN_MS) {
            // A3: cache ≤ 10 min old — silently fall back, skip relay result
            for (const t of boardCache.tasks) {
              const rec = cacheToRecord(t, board.name);
              if (status === "open" && rec.completed) continue;
              if (status === "done" && !rec.completed) continue;
              if (columnId !== undefined && rec.column !== columnId) continue;
              records.push(rec);
            }
            continue;
          } else if (boardCache.tasks.length > 0) {
            // A2: stale cache has tasks — warn and keep, don't overwrite with empty
            process.stderr.write("⚠ Relay returned 0 tasks — keeping cached results\n");
            for (const t of boardCache.tasks) {
              const rec = cacheToRecord(t, board.name);
              if (status === "open" && rec.completed) continue;
              if (status === "done" && !rec.completed) continue;
              if (columnId !== undefined && rec.column !== columnId) continue;
              records.push(rec);
            }
            continue;
          }
        }

        // Write all records (any status) to cache
        cache.boards[board.id] = {
          tasks: liveRecords.map(recordToCache),
          fetchedAt: Date.now(),
        };

        // Filter for the caller
        for (const record of liveRecords) {
          if (columnId !== undefined && record.column !== columnId) continue;
          if (status === "open" && record.completed) continue;
          if (status === "done" && !record.completed) continue;
          records.push(record);
        }
      }

      writeCache(cache);
      records.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
      return records;
    },

    async syncBoard(boardId: string): Promise<{ kind?: string; columns?: { id: string; name: string }[]; children?: string[] }> {
      await ensureConnected();
      const bTag = boardTagHash(boardId);
      const fetchPromise = ndk.fetchEvents(
        { kinds: [30300], "#b": [bTag], limit: 1 } as unknown as Parameters<typeof ndk.fetchEvents>[0],
        { closeOnEose: true },
      );
      const timeoutPromise = new Promise<Set<NDKEvent>>((resolve) =>
        setTimeout(() => resolve(new Set<NDKEvent>()), 10000),
      );
      const events = await Promise.race([fetchPromise, timeoutPromise]);

      // Load fresh config to ensure we have the latest board entry
      const cfg = await loadConfig();
      const entry = cfg.boards.find((b) => b.id === boardId);
      if (!entry) return {};

      let kind: string | undefined;
      let columns: { id: string; name: string }[] | undefined;
      let children: string[] | undefined;

      if (events.size > 0) {
        const [event] = events;
        const kTag = event.tags.find((t) => t[0] === "k");
        if (kTag?.[1]) kind = kTag[1];

        const colTags = event.tags.filter((t) => t[0] === "col" && t[1] && t[2]);
        if (colTags.length > 0) {
          columns = colTags.map((t) => ({ id: t[1], name: t[2] }));
        }

        // Check for "ch" tags
        const chTags = event.tags.filter((t) => t[0] === "ch" && t[1]);
        if (chTags.length > 0) {
          children = chTags.map((t) => t[1]);
        }

        // Try to decrypt content for additional columns and kind (fallback)
        try {
          if (event.content) {
            const plaintext = await decryptContent(boardId, event.content);
            const parsed = JSON.parse(plaintext);

            // Extract kind from content if not found in tags
            if (!kind && parsed.kind) {
              kind = String(parsed.kind);
            }

            // Extract columns from content
            if (Array.isArray(parsed.columns)) {
              const contentCols: { id: string; name: string }[] = parsed.columns
                .filter(
                  (c: unknown) =>
                    c && typeof c === "object" && "id" in (c as object) && "name" in (c as object),
                )
                .map((c: { id: string; name: string }) => ({ id: String(c.id), name: String(c.name) }));

              // Merge with tag-discovered columns (deduplicate by id)
              const merged = [...(columns ?? [])];
              for (const cc of contentCols) {
                if (!merged.find((m) => m.id === cc.id)) {
                  merged.push(cc);
                }
              }
              if (merged.length > 0) columns = merged;
            }

            // Extract children from content
            if (Array.isArray(parsed.children)) {
              const contentChildren = (parsed.children as unknown[]).filter((c): c is string => typeof c === "string");
              const mergedChildren = [...(children ?? [])];
              for (const cc of contentChildren) {
                if (!mergedChildren.includes(cc)) mergedChildren.push(cc);
              }
              if (mergedChildren.length > 0) children = mergedChildren;
            }
          }
        } catch { /* non-fatal — content may not be in expected format */ }

        if (kind) entry.kind = kind as BoardEntry["kind"];
        if (columns && columns.length > 0) entry.columns = columns;
        if (children && children.length > 0) entry.children = children;
        await saveConfig(cfg);
      }

      return { kind, columns, children };
    },

    async createTask(input: AgentTaskCreateInput): Promise<FullTaskRecord> {
      return (this as NostrRuntime).createTaskFull(input);
    },

    async createTaskFull(input: ExtendedCreateInput): Promise<FullTaskRecord> {
      await ensureConnected();
      const entry = resolveBoardEntry(config, input.boardId);
      if (!entry) {
        throw new Error(
          `Board not found in config: "${input.boardId}". Use: taskify board join <id> --name <name>`,
        );
      }
      const boardId = entry.id;
      const taskId = crypto.randomUUID();
      const userPubkey = getUserPubkeyHex(config);
      if (!userPubkey) {
        process.stderr.write(
          "\x1b[33m(warning: no nsec configured — createdBy/lastEditedBy will be empty)\x1b[0m\n",
        );
      }
      const now = Date.now();
      const payload: Record<string, unknown> = {
        title: input.title,
        priority: input.priority ?? null,
        note: input.note ?? "",
        dueISO: input.dueISO ?? "",
        completedAt: null,
        completedBy: null,
        recurrence: null,
        hiddenUntilISO: null,
        createdBy: userPubkey,
        lastEditedBy: userPubkey,
        createdAt: now,
        streak: null,
        longestStreak: null,
        seriesId: null,
        dueDateEnabled: input.dueISO ? true : null,
        dueTimeEnabled: null,
        dueTimeZone: null,
        images: null,
        documents: null,
        bounty: null,
        subtasks: input.subtasks ?? null,
        assignees: input.assignees ? input.assignees.map((pk) => ({ pubkey: pk })) : null,
        inboxItem: input.inboxItem === true ? true : null,
      };
      // Resolve column: explicit > week-board today > ""
      let colId = "";
      if (input.columnId !== undefined) {
        colId = input.columnId;
      } else if (entry.kind === "week") {
        colId = new Date().toISOString().slice(0, 10);
      }
      await publishTaskEvent(boardId, taskId, payload, "open", colId);
      const result: FullTaskRecord = {
        id: taskId,
        boardId,
        boardName: entry.name,
        title: input.title,
        note: input.note || undefined,
        dueISO: input.dueISO ?? "",
        dueDateEnabled: input.dueISO ? true : undefined,
        priority: input.priority,
        completed: false,
        createdAt: Math.floor(now / 1000),
        createdBy: userPubkey,
        lastEditedBy: userPubkey,
        subtasks: input.subtasks,
        column: colId || undefined,
        inboxItem: input.inboxItem === true ? true : undefined,
        assignees: input.assignees,
      };
      // Update cache with the new task
      const cache = readCache();
      const boardCache = cache.boards[boardId] ?? { tasks: [], fetchedAt: Date.now() };
      boardCache.tasks = boardCache.tasks.filter((t) => t.id !== taskId);
      boardCache.tasks.push(recordToCache(result));
      cache.boards[boardId] = boardCache;
      writeCache(cache);
      return result;
    },

    async updateTask(
      taskId: string,
      boardId: string,
      patch: AgentTaskPatchInput,
    ): Promise<FullTaskRecord | null> {
      await ensureConnected();
      const entry = resolveBoardEntry(config, boardId);
      if (!entry) return null;
      const resolvedId = await resolveTaskId(entry.id, taskId);
      if (!resolvedId) return null;
      taskId = resolvedId;
      const events = await fetchBoardEvents(entry.id, taskId);
      if (events.size === 0) return null;
      const [event] = events;
      const existing = await parseDecryptedEvent(event, entry.id, entry.name);
      if (!existing) return null;
      const plaintext = await decryptContent(entry.id, event.content);
      const rawPayload = JSON.parse(plaintext);
      const userPubkey = getUserPubkeyHex(config);
      const merged = {
        ...rawPayload,
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.note !== undefined ? { note: patch.note ?? "" } : {}),
        ...(patch.dueISO !== undefined ? { dueISO: patch.dueISO ?? "" } : {}),
        ...(patch.priority !== undefined ? { priority: patch.priority ?? null } : {}),
        ...(patch.inboxItem !== undefined ? { inboxItem: patch.inboxItem } : {}),
        // Store assignees as {pubkey} objects in Nostr payload for PWA compat
        ...(patch.assignees !== undefined ? { assignees: patch.assignees.map((pk) => ({ pubkey: pk })) } : {}),
        lastEditedBy: userPubkey,
      };
      const statusTag = event.tags.find((t) => t[0] === "status");
      const status = (statusTag?.[1] ?? "open") as "open" | "done" | "deleted";
      const colTag = event.tags.find((t) => t[0] === "col");
      const existingColId = colTag?.[1] ?? "";
      const colId = patch.columnId !== undefined ? (patch.columnId ?? "") : existingColId;
      await publishTaskEvent(entry.id, taskId, merged, status, colId);
      // Build updated FullTaskRecord — keep assignees as string[] (extract pubkeys)
      const updatedAssignees: string[] | undefined = patch.assignees !== undefined
        ? patch.assignees
        : existing.assignees;
      const updated: FullTaskRecord = {
        ...existing,
        title: merged.title ?? existing.title,
        note: merged.note || undefined,
        dueISO: merged.dueISO ?? existing.dueISO,
        priority: merged.priority ?? undefined,
        inboxItem: merged.inboxItem === true ? true : undefined,
        assignees: updatedAssignees,
        lastEditedBy: merged.lastEditedBy,
      };
      if (patch.columnId !== undefined) updated.column = colId || undefined;
      // Invalidate cache entry
      const cache = readCache();
      const bc = cache.boards[entry.id];
      if (bc) {
        bc.tasks = bc.tasks.filter((t) => t.id !== taskId);
        bc.tasks.push(recordToCache(updated));
        writeCache(cache);
      }
      return updated;
    },

    async setTaskStatus(
      taskId: string,
      status: AgentTaskStatus,
      boardId: string,
    ): Promise<FullTaskRecord | null> {
      await ensureConnected();
      const entry = resolveBoardEntry(config, boardId);
      if (!entry) return null;
      const resolvedId = await resolveTaskId(entry.id, taskId);
      if (!resolvedId) return null;
      taskId = resolvedId;
      const events = await fetchBoardEvents(entry.id, taskId);
      if (events.size === 0) return null;
      const [event] = events;
      const existing = await parseDecryptedEvent(event, entry.id, entry.name);
      if (!existing) return null;
      const plaintext = await decryptContent(entry.id, event.content);
      const rawPayload = JSON.parse(plaintext);
      const userPubkey = getUserPubkeyHex(config);
      const completed = status === "done";
      const merged = {
        ...rawPayload,
        completedAt: completed ? nowISO() : null,
        lastEditedBy: userPubkey,
      };
      const nostrStatus: "open" | "done" | "deleted" = completed ? "done" : "open";
      const colTag = event.tags.find((t) => t[0] === "col");
      const colId = colTag?.[1] ?? "";
      await publishTaskEvent(entry.id, taskId, merged, nostrStatus, colId);
      const updated = { ...existing, completed, completedAt: merged.completedAt ?? undefined };
      // Update cache
      const cache = readCache();
      const bc = cache.boards[entry.id];
      if (bc) {
        bc.tasks = bc.tasks.filter((t) => t.id !== taskId);
        bc.tasks.push(recordToCache(updated));
        writeCache(cache);
      }
      return updated;
    },

    async deleteTask(taskId: string, boardId: string): Promise<FullTaskRecord | null> {
      await ensureConnected();
      const entry = resolveBoardEntry(config, boardId);
      if (!entry) return null;
      const resolvedId = await resolveTaskId(entry.id, taskId);
      if (!resolvedId) return null;
      taskId = resolvedId;
      const events = await fetchBoardEvents(entry.id, taskId);
      if (events.size === 0) return null;
      const [event] = events;
      const existing = await parseDecryptedEvent(event, entry.id, entry.name);
      if (!existing) return null;
      const plaintext = await decryptContent(entry.id, event.content);
      const rawPayload = JSON.parse(plaintext);
      const colTag = event.tags.find((t) => t[0] === "col");
      const colId = colTag?.[1] ?? "";

      // Step 1: publish kind 30301 status=deleted (app-level soft delete)
      await publishTaskEvent(entry.id, taskId, rawPayload, "deleted", colId);

      // Step 2: publish NIP-09 kind 5 deletion request (matches PWA's publishTaskDeletionRequest)
      const boardKeys = deriveBoardKeys(entry.id);
      const aTag = `30301:${boardKeys.pk}:${taskId}`;
      try {
        const nip09Event = new NDKEvent(ndk);
        nip09Event.kind = 5;
        nip09Event.content = "Task deleted";
        nip09Event.tags = [["a", aTag]];
        nip09Event.created_at = Math.floor(Date.now() / 1000);
        ndk.signer = boardKeys.signer;
        await nip09Event.publish();
      } catch {
        // Non-fatal: NIP-09 relay support varies; soft delete already published
      }

      // Remove from cache
      const cache = readCache();
      const bc = cache.boards[entry.id];
      if (bc) {
        bc.tasks = bc.tasks.filter((t) => t.id !== taskId);
        writeCache(cache);
      }

      return existing;
    },

    async toggleSubtask(
      taskId: string,
      boardId: string,
      subtaskRef: string,
      completed: boolean,
    ): Promise<FullTaskRecord | null> {
      await ensureConnected();
      const entry = resolveBoardEntry(config, boardId);
      if (!entry) return null;
      const resolvedId = await resolveTaskId(entry.id, taskId);
      if (!resolvedId) return null;
      taskId = resolvedId;
      const events = await fetchBoardEvents(entry.id, taskId);
      if (events.size === 0) return null;
      const [event] = events;
      const existing = await parseDecryptedEvent(event, entry.id, entry.name);
      if (!existing) return null;
      const plaintext = await decryptContent(entry.id, event.content);
      const rawPayload = JSON.parse(plaintext);
      const subtasks: Array<{ id: string; title: string; completed: boolean }> =
        rawPayload.subtasks ?? [];
      // Resolve by 1-based index or title substring
      const indexNum = parseInt(subtaskRef, 10);
      let targetIdx = -1;
      if (!isNaN(indexNum) && indexNum >= 1 && indexNum <= subtasks.length) {
        targetIdx = indexNum - 1;
      } else {
        const lower = subtaskRef.toLowerCase();
        targetIdx = subtasks.findIndex((s) => s.title.toLowerCase().includes(lower));
      }
      if (targetIdx === -1) {
        throw new Error(`Subtask not found: ${subtaskRef}`);
      }
      subtasks[targetIdx] = { ...subtasks[targetIdx], completed };
      rawPayload.subtasks = subtasks;
      const statusTag = event.tags.find((t) => t[0] === "status");
      const status = (statusTag?.[1] ?? "open") as "open" | "done" | "deleted";
      const colTag = event.tags.find((t) => t[0] === "col");
      const colId = colTag?.[1] ?? "";
      await publishTaskEvent(entry.id, taskId, rawPayload, status, colId);
      return { ...existing, subtasks };
    },

    async getTask(taskId: string, boardId?: string): Promise<FullTaskRecord | null> {
      await ensureConnected();
      const boards: BoardEntry[] = [];
      if (boardId) {
        const entry = resolveBoardEntry(config, boardId);
        if (entry) boards.push(entry);
      } else {
        boards.push(...config.boards);
      }
      for (const board of boards) {
        // Try exact UUID match via #d filter
        const events = await fetchBoardEvents(board.id, taskId);
        for (const event of events) {
          const record = await parseDecryptedEvent(event, board.id, board.name);
          if (record) return record;
        }
        // UUID prefix match: fetch all and scan
        if (taskId.length < 36) {
          const allEvents = await fetchBoardEvents(board.id);
          const prefix = taskId.toLowerCase().slice(0, 8);
          for (const event of allEvents) {
            const dTag = event.tags.find((t) => t[0] === "d");
            const dVal = (dTag?.[1] ?? "").toLowerCase();
            if (dVal.startsWith(prefix)) {
              const record = await parseDecryptedEvent(event, board.id, board.name);
              if (record) return record;
            }
          }
        }
      }
      return null;
    },

    async remindTask(taskId: string, presets: ReminderPreset[]): Promise<void> {
      // Device-local only — NEVER publish to Nostr
      const cfg = await loadConfig();
      if (!cfg.taskReminders) cfg.taskReminders = {};
      cfg.taskReminders[taskId] = presets;
      await saveConfig(cfg);
      process.stderr.write(
        "\x1b[2m  Note: Reminders are device-local and will not sync to other devices\x1b[0m\n",
      );
    },

    getLocalReminders(taskId: string): ReminderPreset[] {
      return config.taskReminders?.[taskId] ?? [];
    },

    async getAgentSecurityConfig(): Promise<AgentSecurityConfig> {
      const cfg = await loadConfig();
      return {
        enabled: cfg.securityEnabled,
        mode: cfg.securityMode,
        trustedNpubs: cfg.trustedNpubs,
        updatedISO: nowISO(),
      };
    },

    async setAgentSecurityConfig(secCfg: AgentSecurityConfig): Promise<AgentSecurityConfig> {
      const cfg = await loadConfig();
      cfg.securityEnabled = secCfg.enabled;
      cfg.securityMode = secCfg.mode;
      cfg.trustedNpubs = secCfg.trustedNpubs;
      await saveConfig(cfg);
      return secCfg;
    },

    async getRelayStatus(): Promise<{ url: string; connected: boolean }[]> {
      await ensureConnected();
      const results: { url: string; connected: boolean }[] = [];
      for (const [url, relay] of ndk.pool.relays) {
        const connected = relay.status === NDKRelayStatus.CONNECTED;
        results.push({ url, connected });
      }
      // If pool is empty (no relays in map), fall back to config list as disconnected
      if (results.length === 0) {
        for (const url of config.relays) {
          results.push({ url, connected: false });
        }
      }
      return results;
    },

    async createBoard(input: {
      name: string;
      kind: "lists" | "week";
      columns?: { id: string; name: string }[];
    }): Promise<{ boardId: string }> {
      await ensureConnected();
      const boardId = crypto.randomUUID();
      const { signer } = deriveBoardKeys(boardId);
      const bTag = boardTagHash(boardId);

      const contentPayload = {
        name: input.name,
        kind: input.kind,
        columns: input.columns ?? [],
        version: 1,
      };
      const encrypted = await encryptContent(boardId, JSON.stringify(contentPayload));

      const event = new NDKEvent(ndk);
      event.kind = 30300;
      event.content = encrypted;
      event.tags = [
        ["d", boardId],
        ["b", bTag],
        ["k", input.kind],
        ...(input.columns ?? []).map((c): string[] => ["col", c.id, c.name]),
      ];
      await event.sign(signer);
      try {
        await event.publish();
      } catch (err) {
        throw new Error(`Board publish failed: ${String(err)}`);
      }

      // Auto-join: save to config
      const cfg = await loadConfig();
      const newEntry: BoardEntry = {
        id: boardId,
        name: input.name,
        kind: input.kind,
        columns: input.columns ?? [],
      };
      cfg.boards.push(newEntry);
      await saveConfig(cfg);

      return { boardId };
    },
  };
}
