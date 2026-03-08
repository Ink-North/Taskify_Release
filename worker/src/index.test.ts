import test from "node:test";
import assert from "node:assert/strict";
import worker from "./index.ts";

type DeviceRow = {
  device_id: string;
  platform: "ios" | "android";
  endpoint: string;
  endpoint_hash: string;
  subscription_auth: string;
  subscription_p256dh: string;
  updated_at: number;
};

type ReminderRow = {
  device_id: string;
  reminder_key: string;
  task_id: string;
  board_id: string | null;
  title: string;
  due_iso: string;
  minutes: number;
  send_at: number;
};

type PendingRow = {
  id: number;
  device_id: string;
  task_id: string;
  board_id: string | null;
  title: string;
  due_iso: string;
  minutes: number;
  created_at: number;
};

class MockD1 {
  devices = new Map<string, DeviceRow>();
  reminders: ReminderRow[] = [];
  pending: PendingRow[] = [];
  pendingId = 1;

  prepare(query: string) {
    const db = this;
    const sql = query.replace(/\s+/g, " ").trim();
    let params: unknown[] = [];

    return {
      bind(...values: unknown[]) {
        params = values;
        return this;
      },
      async run() {
        if (/^PRAGMA /i.test(sql) || /^CREATE TABLE/i.test(sql) || /^CREATE INDEX/i.test(sql)) {
          return { success: true };
        }
        if (sql.startsWith("DELETE FROM pending_notifications WHERE device_id = ?")) {
          const [deviceId] = params as [string];
          db.pending = db.pending.filter((p) => p.device_id !== deviceId);
          return { success: true };
        }
        if (sql.startsWith("DELETE FROM reminders WHERE device_id = ?")) {
          const [deviceId] = params as [string];
          db.reminders = db.reminders.filter((r) => r.device_id !== deviceId);
          return { success: true };
        }
        if (sql.startsWith("DELETE FROM pending_notifications WHERE id = ?")) {
          const [id] = params as [number];
          db.pending = db.pending.filter((p) => p.id !== id);
          return { success: true };
        }
        return { success: true };
      },
      async first() {
        if (sql.includes("FROM devices") && sql.includes("WHERE device_id = ?")) {
          const [deviceId] = params as [string];
          return db.devices.get(deviceId) ?? null;
        }
        if (sql.includes("SELECT device_id") && sql.includes("FROM devices") && sql.includes("endpoint_hash = ?")) {
          const [hash] = params as [string];
          const found = [...db.devices.values()].find((d) => d.endpoint_hash === hash);
          return found ? ({ device_id: found.device_id } as any) : null;
        }
        return null;
      },
      async all() {
        if (sql.includes("FROM pending_notifications") && sql.includes("WHERE device_id = ?")) {
          const [deviceId] = params as [string];
          const rows = db.pending
            .filter((p) => p.device_id === deviceId)
            .sort((a, b) => (a.created_at - b.created_at) || (a.id - b.id));
          return { success: true, results: rows };
        }
        if (sql.includes("FROM reminders") && sql.includes("WHERE send_at <= ?")) {
          const [now, limit] = params as [number, number];
          const rows = db.reminders
            .filter((r) => r.send_at <= now)
            .sort((a, b) => a.send_at - b.send_at)
            .slice(0, limit);
          return { success: true, results: rows };
        }
        return { success: true, results: [] };
      },
    };
  }

  async batch(statements: any[]) {
    for (const st of statements) {
      // brute force execute by calling run() when possible
      if (typeof st.run === "function") {
        await st.run();
      }
      // handle inserts by peeking at private captured SQL via toString fallback is unavailable;
      // rely on side effects when tests manually seed state where needed.
    }
    return [];
  }
}

function makeEnv(db: MockD1) {
  return {
    ASSETS: {
      fetch: async () => new Response("asset", { status: 200 }),
    },
    TASKIFY_DB: db as any,
    VAPID_PUBLIC_KEY: "",
    VAPID_PRIVATE_KEY: "",
    VAPID_SUBJECT: "mailto:test@example.com",
  } as any;
}

test("GET /api/config returns worker origin and vapid key", async () => {
  const db = new MockD1();
  const env = makeEnv(db);
  env.VAPID_PUBLIC_KEY = "test-public-key";

  const req = new Request("https://taskify-v2.solife.me/api/config", { method: "GET" });
  const res = await worker.fetch(req, env);
  assert.equal(res.status, 200);
  const body = await res.json() as any;
  assert.equal(body.workerBaseUrl, "https://taskify-v2.solife.me");
  assert.equal(body.vapidPublicKey, "test-public-key");
});

test("PUT /api/reminders returns 404 for unknown device", async () => {
  const db = new MockD1();
  const env = makeEnv(db);

  const req = new Request("https://taskify-v2.solife.me/api/reminders", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deviceId: "missing", reminders: [] }),
  });

  const res = await worker.fetch(req, env);
  assert.equal(res.status, 404);
  const body = await res.json() as any;
  assert.match(body.error, /Unknown device/i);
});

test("POST /api/reminders/poll returns pending notifications and drains them", async () => {
  const db = new MockD1();
  const env = makeEnv(db);

  db.pending.push({
    id: 1,
    device_id: "dev-1",
    task_id: "task-1",
    board_id: "board-1",
    title: "Task",
    due_iso: new Date(Date.now() + 60000).toISOString(),
    minutes: 15,
    created_at: Date.now(),
  });

  const req = new Request("https://taskify-v2.solife.me/api/reminders/poll", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deviceId: "dev-1" }),
  });

  const res = await worker.fetch(req, env);
  assert.equal(res.status, 200);
  const body = await res.json() as any[];
  assert.equal(body.length, 1);
  assert.equal(body[0].taskId, "task-1");

  assert.equal(db.pending.length, 0, "pending notifications should be drained after poll");
});

test("scheduled handler runs with empty due reminders without throwing", async () => {
  const db = new MockD1();
  const env = makeEnv(db);

  let waited = false;
  const ctx = {
    waitUntil(p: Promise<unknown>) {
      waited = true;
      p.catch(() => {});
    },
  };

  await worker.scheduled({ scheduledTime: Date.now(), cron: "* * * * *" } as any, env, ctx as any);
  assert.equal(waited, true);
});
