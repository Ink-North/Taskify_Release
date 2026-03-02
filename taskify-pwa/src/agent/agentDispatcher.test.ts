import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { nip19 } from "nostr-tools";
import { dispatchAgentCommand } from "./agentDispatcher.ts";
import {
  defaultAgentSecurityConfig,
  normalizeAgentSecurityConfig,
  type AgentSecurityConfig,
} from "./agentSecurity.ts";
import { setAgentIdempotencyStore, type AgentIdempotencyStore } from "./agentIdempotency.ts";
import {
  setAgentRuntime,
  type AgentRuntime,
  type AgentTaskRecord,
} from "./agentRuntime.ts";

const TRUSTED_HEX = `02${"11".repeat(32)}`;
const UNTRUSTED_HEX = `03${"22".repeat(32)}`;
const TRUSTED_NPUB = nip19.npubEncode(TRUSTED_HEX.slice(-64));

function makeTask(overrides: Partial<AgentTaskRecord> = {}): AgentTaskRecord {
  return {
    id: overrides.id ?? "task-1",
    boardId: overrides.boardId ?? "board-1",
    title: overrides.title ?? "Task",
    note: overrides.note ?? "",
    dueISO: overrides.dueISO ?? "2026-03-01T09:00:00.000Z",
    dueDateEnabled: overrides.dueDateEnabled ?? true,
    completed: overrides.completed ?? false,
    createdAt: overrides.createdAt ?? Date.parse("2026-03-01T09:00:00.000Z"),
    updatedAt: overrides.updatedAt ?? "2026-03-01T09:00:00.000Z",
    ...(overrides.createdBy !== undefined ? { createdBy: overrides.createdBy } : {}),
    ...(overrides.lastEditedBy !== undefined ? { lastEditedBy: overrides.lastEditedBy } : {}),
    ...(overrides.priority !== undefined ? { priority: overrides.priority } : {}),
  };
}

function createRuntime(options?: {
  tasks?: AgentTaskRecord[];
  securityConfig?: Partial<AgentSecurityConfig>;
}) {
  let createCount = 0;
  let nextTaskId = 100;
  let tasks = (options?.tasks ?? []).map((task) => ({ ...task }));
  let securityConfig = normalizeAgentSecurityConfig({
    ...defaultAgentSecurityConfig(),
    ...(options?.securityConfig ?? {}),
  });

  const runtime: AgentRuntime = {
    getDefaultBoardId() {
      return "board-1";
    },
    async getTask(taskId) {
      return tasks.find((task) => task.id === taskId) ?? null;
    },
    async listTasks({ boardId, status }) {
      return tasks.filter((task) => {
        if (boardId && task.boardId !== boardId) return false;
        if (status === "open" && task.completed) return false;
        if (status === "done" && !task.completed) return false;
        return true;
      });
    },
    async createTask(input) {
      createCount += 1;
      const created = makeTask({
        id: `task-${nextTaskId++}`,
        boardId: input.boardId,
        title: input.title,
        note: input.note,
        dueISO: input.dueISO ?? "2026-03-01T09:00:00.000Z",
        priority: input.priority,
        updatedAt: new Date(Date.parse("2026-03-01T09:00:00.000Z") + createCount * 1000).toISOString(),
      });
      tasks = [...tasks, created];
      return created;
    },
    async updateTask(taskId, patch) {
      const existing = tasks.find((task) => task.id === taskId);
      if (!existing) return null;
      const updated: AgentTaskRecord = {
        ...existing,
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.note !== undefined ? { note: patch.note } : {}),
        ...(patch.dueISO === null
          ? { dueDateEnabled: false, dueTimeEnabled: false }
          : patch.dueISO !== undefined
            ? { dueISO: patch.dueISO, dueDateEnabled: true }
            : {}),
        ...(patch.priority === null
          ? { priority: undefined }
          : patch.priority !== undefined
            ? { priority: patch.priority }
            : {}),
        updatedAt: "2026-03-02T10:00:00.000Z",
      };
      tasks = tasks.map((task) => (task.id === taskId ? updated : task));
      return updated;
    },
    async setTaskStatus(taskId, status) {
      const existing = tasks.find((task) => task.id === taskId);
      if (!existing) return null;
      const updated: AgentTaskRecord = {
        ...existing,
        completed: status === "done",
        completedAt: status === "done" ? "2026-03-02T11:00:00.000Z" : undefined,
        updatedAt: "2026-03-02T11:00:00.000Z",
      };
      tasks = tasks.map((task) => (task.id === taskId ? updated : task));
      return updated;
    },
    getAgentSecurityConfig() {
      return securityConfig;
    },
    setAgentSecurityConfig(config) {
      securityConfig = normalizeAgentSecurityConfig(config);
      return securityConfig;
    },
  };

  return {
    runtime,
    getTasks: () => tasks,
    getSecurityConfig: () => securityConfig,
    getCreateCount: () => createCount,
  };
}

function createIdempotencyStore(): AgentIdempotencyStore {
  const entries = new Map<string, string>();
  return {
    async get(key: string) {
      return entries.get(key) ?? null;
    },
    async set(key: string, taskId: string) {
      entries.set(key, taskId);
    },
  };
}

async function run(command: Record<string, unknown>) {
  return await dispatchAgentCommand(JSON.stringify(command));
}

afterEach(() => {
  setAgentRuntime(null);
  setAgentIdempotencyStore(null);
});

test("invalid JSON returns PARSE_JSON", async () => {
  const runtimeState = createRuntime();
  setAgentRuntime(runtimeState.runtime);
  const response = await dispatchAgentCommand("{");
  assert.equal(response.ok, false);
  assert.equal(response.error?.code, "PARSE_JSON");
  assert.equal(response.id, null);
});

test("validation errors return VALIDATION with details", async () => {
  const runtimeState = createRuntime();
  setAgentRuntime(runtimeState.runtime);
  const response = await run({
    v: 1,
    id: "bad-create",
    op: "task.create",
    params: { dueISO: "not-an-iso" },
  });
  assert.equal(response.ok, false);
  assert.equal(response.error?.code, "VALIDATION");
  assert.deepEqual(response.error?.details, {
    "params.title": "Expected string",
    "params.dueISO": "Expected ISO 8601 string",
  });
});

test("dispatcher accepts higher numeric versions", async () => {
  const runtimeState = createRuntime();
  setAgentRuntime(runtimeState.runtime);
  const response = await run({
    v: 2,
    id: "help-v2",
    op: "meta.help",
    params: {},
  });
  assert.equal(response.ok, true);
  assert.equal(response.v, 2);
  assert.equal(response.id, "help-v2");
});

test("dispatcher accepts version alias", async () => {
  const runtimeState = createRuntime();
  setAgentRuntime(runtimeState.runtime);
  const response = await dispatchAgentCommand(
    JSON.stringify({
      version: 3,
      id: "help-v3",
      op: "meta.help",
      params: {},
    }),
  );
  assert.equal(response.ok, true);
  assert.equal(response.v, 3);
  assert.equal(response.id, "help-v3");
});

test("task.create with idempotencyKey does not create duplicates", async () => {
  const runtimeState = createRuntime();
  setAgentRuntime(runtimeState.runtime);
  setAgentIdempotencyStore(createIdempotencyStore());

  const first = await run({
    v: 1,
    id: "create-1",
    op: "task.create",
    params: {
      title: "Buy groceries",
      idempotencyKey: "buy-groceries-1",
    },
  });
  const second = await run({
    v: 1,
    id: "create-2",
    op: "task.create",
    params: {
      title: "Buy groceries",
      idempotencyKey: "buy-groceries-1",
    },
  });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.result?.taskId, second.result?.taskId);
  assert.equal(runtimeState.getCreateCount(), 1);
  assert.equal(runtimeState.getTasks().length, 1);
});

test("task.list pagination returns nextCursor", async () => {
  const runtimeState = createRuntime({
    tasks: [
      makeTask({ id: "task-a", title: "A", updatedAt: "2026-03-01T01:00:00.000Z" }),
      makeTask({ id: "task-b", title: "B", updatedAt: "2026-03-01T02:00:00.000Z" }),
      makeTask({ id: "task-c", title: "C", updatedAt: "2026-03-01T03:00:00.000Z" }),
    ],
  });
  setAgentRuntime(runtimeState.runtime);

  const first = await run({
    v: 1,
    id: "list-1",
    op: "task.list",
    params: { status: "open", limit: 2 },
  });
  assert.equal(first.ok, true);
  assert.deepEqual(
    (first.result?.items as Array<{ id: string }>).map((item) => item.id),
    ["task-c", "task-b"],
  );
  assert.equal(typeof first.result?.nextCursor, "string");

  const second = await run({
    v: 1,
    id: "list-2",
    op: "task.list",
    params: { status: "open", limit: 2, cursor: first.result?.nextCursor },
  });
  assert.equal(second.ok, true);
  assert.deepEqual(
    (second.result?.items as Array<{ id: string }>).map((item) => item.id),
    ["task-a"],
  );
  assert.equal(second.result?.nextCursor, null);
});

test("task.list query filters by title and note text", async () => {
  const runtimeState = createRuntime({
    tasks: [
      makeTask({ id: "task-q", title: "qwen35b test", note: "model regression" }),
      makeTask({ id: "task-g", title: "gpt20b test", note: "follow up" }),
      makeTask({ id: "task-n", title: "other", note: "mentions QWEN35B inside note" }),
    ],
  });
  setAgentRuntime(runtimeState.runtime);

  const response = await run({
    v: 1,
    id: "list-query",
    op: "task.list",
    params: { status: "any", query: "qwen35b", limit: 10 },
  });

  assert.equal(response.ok, true);
  assert.deepEqual(
    (response.result?.items as Array<{ id: string }>).map((item) => item.id),
    ["task-n", "task-q"],
  );
  assert.deepEqual(response.result?.counts, {
    trusted: 0,
    untrusted: 0,
    unknown: 2,
    returned: 2,
  });
});

test("strict mode filters out untrusted and unknown tasks", async () => {
  const runtimeState = createRuntime({
    tasks: [
      makeTask({
        id: "trusted-task",
        title: "Trusted",
        updatedAt: "2026-03-01T03:00:00.000Z",
        createdBy: TRUSTED_HEX,
        lastEditedBy: TRUSTED_HEX,
      }),
      makeTask({
        id: "untrusted-task",
        title: "Untrusted",
        updatedAt: "2026-03-01T02:00:00.000Z",
        createdBy: UNTRUSTED_HEX,
        lastEditedBy: UNTRUSTED_HEX,
      }),
      makeTask({
        id: "unknown-task",
        title: "Unknown",
        updatedAt: "2026-03-01T01:00:00.000Z",
        createdBy: undefined,
        lastEditedBy: undefined,
      }),
    ],
    securityConfig: {
      enabled: true,
      mode: "strict",
      trustedNpubs: [TRUSTED_NPUB],
    },
  });
  setAgentRuntime(runtimeState.runtime);

  const response = await run({
    v: 1,
    id: "strict-list",
    op: "task.list",
    params: { status: "open", limit: 10 },
  });

  assert.equal(response.ok, true);
  assert.deepEqual(
    (response.result?.items as Array<{ id: string }>).map((item) => item.id),
    ["trusted-task"],
  );
  // In strict mode, counts reflect only the accessible (trusted) items
  assert.deepEqual(response.result?.counts, {
    trusted: 1,
    untrusted: 0,
    unknown: 0,
    returned: 1,
  });
});

test("moderate mode returns all tasks with trust flags", async () => {
  const runtimeState = createRuntime({
    tasks: [
      makeTask({
        id: "trusted-task",
        title: "Trusted",
        updatedAt: "2026-03-01T03:00:00.000Z",
        createdBy: TRUSTED_HEX,
        lastEditedBy: TRUSTED_HEX,
      }),
      makeTask({
        id: "untrusted-task",
        title: "Untrusted",
        updatedAt: "2026-03-01T02:00:00.000Z",
        createdBy: UNTRUSTED_HEX,
        lastEditedBy: UNTRUSTED_HEX,
      }),
      makeTask({
        id: "unknown-task",
        title: "Unknown",
        updatedAt: "2026-03-01T01:00:00.000Z",
        createdBy: undefined,
        lastEditedBy: undefined,
      }),
    ],
    securityConfig: {
      enabled: true,
      mode: "moderate",
      trustedNpubs: [TRUSTED_NPUB],
    },
  });
  setAgentRuntime(runtimeState.runtime);

  const response = await run({
    v: 1,
    id: "moderate-list",
    op: "task.list",
    params: { status: "open", limit: 10 },
  });

  assert.equal(response.ok, true);
  const items = response.result?.items as Array<{
    id: string;
    provenance: string;
    trusted: boolean;
    agentSafe: boolean;
  }>;
  assert.equal(items.length, 3);
  assert.deepEqual(
    items.map((item) => item.id),
    ["trusted-task", "untrusted-task", "unknown-task"],
  );
  assert.deepEqual(items.find((item) => item.id === "trusted-task"), {
    ...items.find((item) => item.id === "trusted-task"),
    provenance: "trusted",
    trusted: true,
    agentSafe: true,
  });
  assert.deepEqual(items.find((item) => item.id === "untrusted-task"), {
    ...items.find((item) => item.id === "untrusted-task"),
    provenance: "untrusted",
    trusted: false,
    agentSafe: false,
  });
  assert.deepEqual(items.find((item) => item.id === "unknown-task"), {
    ...items.find((item) => item.id === "unknown-task"),
    provenance: "unknown",
    trusted: false,
    agentSafe: false,
  });
});

test("off mode returns all tasks with provenance computed", async () => {
  const runtimeState = createRuntime({
    tasks: [
      makeTask({
        id: "trusted-task",
        title: "Trusted",
        updatedAt: "2026-03-01T02:00:00.000Z",
        createdBy: TRUSTED_HEX,
        lastEditedBy: TRUSTED_HEX,
      }),
      makeTask({
        id: "unknown-task",
        title: "Unknown",
        updatedAt: "2026-03-01T01:00:00.000Z",
        createdBy: undefined,
        lastEditedBy: undefined,
      }),
    ],
    securityConfig: {
      enabled: false,
      mode: "strict",
      trustedNpubs: [TRUSTED_NPUB],
    },
  });
  setAgentRuntime(runtimeState.runtime);

  const response = await run({
    v: 1,
    id: "off-list",
    op: "task.list",
    params: { status: "open", limit: 10 },
  });

  assert.equal(response.ok, true);
  const items = response.result?.items as Array<{ id: string; provenance: string }>;
  assert.equal(items.length, 2);
  assert.equal(items.find((item) => item.id === "trusted-task")?.provenance, "trusted");
  assert.equal(items.find((item) => item.id === "unknown-task")?.provenance, "unknown");
});

test("agent trust commands add remove and clear trusted npubs", async () => {
  const runtimeState = createRuntime();
  setAgentRuntime(runtimeState.runtime);

  const addFirst = await run({
    v: 1,
    id: "trust-add-1",
    op: "agent.trust.add",
    params: { npub: TRUSTED_NPUB.toUpperCase() },
  });
  assert.equal(addFirst.ok, true);
  assert.deepEqual(addFirst.result?.trustedNpubs, [TRUSTED_NPUB]);

  const addSecond = await run({
    v: 1,
    id: "trust-add-2",
    op: "agent.trust.add",
    params: { npub: TRUSTED_NPUB },
  });
  assert.equal(addSecond.ok, true);
  assert.deepEqual(addSecond.result?.trustedNpubs, [TRUSTED_NPUB]);

  const remove = await run({
    v: 1,
    id: "trust-remove-1",
    op: "agent.trust.remove",
    params: { npub: TRUSTED_NPUB },
  });
  assert.equal(remove.ok, true);
  assert.deepEqual(remove.result?.trustedNpubs, []);

  await run({
    v: 1,
    id: "trust-add-3",
    op: "agent.trust.add",
    params: { npub: TRUSTED_NPUB },
  });
  await run({
    v: 1,
    id: "trust-add-4",
    op: "agent.trust.add",
    params: { npub: nip19.npubEncode(UNTRUSTED_HEX.slice(-64)) },
  });

  const cleared = await run({
    v: 1,
    id: "trust-clear-1",
    op: "agent.trust.clear",
    params: {},
  });
  assert.equal(cleared.ok, true);
  assert.deepEqual(cleared.result?.trustedNpubs, []);
  assert.deepEqual(runtimeState.getSecurityConfig().trustedNpubs, []);
});

test("strict mode task.get returns FORBIDDEN for untrusted task", async () => {
  const runtimeState = createRuntime({
    tasks: [
      makeTask({
        id: "untrusted-task",
        title: "Untrusted",
        createdBy: UNTRUSTED_HEX,
        lastEditedBy: UNTRUSTED_HEX,
      }),
    ],
    securityConfig: {
      enabled: true,
      mode: "strict",
      trustedNpubs: [TRUSTED_NPUB],
    },
  });
  setAgentRuntime(runtimeState.runtime);

  const response = await run({
    v: 1,
    id: "get-untrusted",
    op: "task.get",
    params: { taskId: "untrusted-task" },
  });

  assert.equal(response.ok, false);
  assert.equal(response.error?.code, "FORBIDDEN");
});
