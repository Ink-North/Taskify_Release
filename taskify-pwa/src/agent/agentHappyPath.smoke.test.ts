import test from "node:test";
import assert from "node:assert/strict";
import { dispatchAgentCommand } from "./agentDispatcher.ts";
import { setAgentRuntime, type AgentRuntime, type AgentTaskRecord } from "./agentRuntime.ts";

function createRuntime() {
  let tasks: AgentTaskRecord[] = [];

  const runtime: AgentRuntime = {
    getDefaultBoardId() {
      return "board-1";
    },
    async getTask(taskId) {
      return tasks.find((t) => t.id === taskId) ?? null;
    },
    async listTasks({ status }) {
      return tasks.filter((t) => {
        if (status === "open") return !t.completed;
        if (status === "done") return t.completed;
        return true;
      });
    },
    async createTask(input) {
      const task: AgentTaskRecord = {
        id: `task-${tasks.length + 1}`,
        boardId: input.boardId || "board-1",
        title: input.title,
        note: input.note || "",
        dueISO: input.dueISO || null,
        dueDateEnabled: Boolean(input.dueISO),
        dueTimeEnabled: false,
        dueTimeZone: undefined,
        completed: false,
        createdAt: Date.now(),
        updatedAt: new Date().toISOString(),
        priority: input.priority,
      };
      tasks.push(task);
      return task;
    },
    async updateTask(taskId, patch) {
      const idx = tasks.findIndex((t) => t.id === taskId);
      if (idx < 0) return null;
      tasks[idx] = { ...tasks[idx], ...patch, updatedAt: new Date().toISOString() } as AgentTaskRecord;
      return tasks[idx];
    },
    async setTaskStatus(taskId, status) {
      const idx = tasks.findIndex((t) => t.id === taskId);
      if (idx < 0) return null;
      tasks[idx] = {
        ...tasks[idx],
        completed: status === "done",
        updatedAt: new Date().toISOString(),
      };
      return tasks[idx];
    },
    getAgentSecurityConfig() {
      return {
        enabled: true,
        mode: "moderate",
        trustedNpubs: [],
        updatedISO: new Date().toISOString(),
      };
    },
    setAgentSecurityConfig(config) {
      return config;
    },
  };

  return { runtime };
}

test("agent happy-path smoke: create -> list open -> complete -> list done", async () => {
  const { runtime } = createRuntime();
  setAgentRuntime(runtime);

  const createRes = await dispatchAgentCommand(
    JSON.stringify({ v: 1, id: "create-1", op: "task.create", params: { title: "Ship release" } }),
  );
  assert.equal(createRes.ok, true);
  const createdTask = (createRes.result as any).task;
  assert.equal(createdTask.title, "Ship release");

  const openRes = await dispatchAgentCommand(
    JSON.stringify({ v: 1, id: "list-open", op: "task.list", params: { status: "open" } }),
  );
  assert.equal(openRes.ok, true);
  assert.equal(((openRes.result as any).items || []).length, 1);

  const doneRes = await dispatchAgentCommand(
    JSON.stringify({
      v: 1,
      id: "done-1",
      op: "task.setStatus",
      params: { taskId: createdTask.id, status: "done" },
    }),
  );
  assert.equal(doneRes.ok, true);

  const listDoneRes = await dispatchAgentCommand(
    JSON.stringify({ v: 1, id: "list-done", op: "task.list", params: { status: "done" } }),
  );
  assert.equal(listDoneRes.ok, true);
  assert.equal(((listDoneRes.result as any).items || []).length, 1);
});
