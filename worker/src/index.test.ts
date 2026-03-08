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
      _sql: sql,
      _getParams: () => params,
      bind(...values: unknown[]) {
        params = values;
        return this;
      },
      async run() {
        if (/^PRAGMA /i.test(sql) || /^CREATE TABLE/i.test(sql) || /^CREATE INDEX/i.test(sql)) {
          return { success: true };
        }

        if (sql.startsWith("INSERT INTO devices ")) {
          const [device_id, platform, endpoint, endpoint_hash, auth, p256dh, updated_at] = params as [
            string,
            "ios" | "android",
            string,
            string,
            string,
            string,
            number,
          ];
          db.devices.set(device_id, {
            device_id,
            platform,
            endpoint,
            endpoint_hash,
            subscription_auth: auth,
            subscription_p256dh: p256dh,
            updated_at,
          });
          return { success: true };
        }

        if (sql.startsWith("INSERT INTO reminders ")) {
          const [device_id, reminder_key, task_id, board_id, title, due_iso, minutes, send_at] = params as [
            string,
            string,
            string,
            string | null,
            string,
            string,
            number,
            number,
          ];
          db.reminders.push({ device_id, reminder_key, task_id, board_id, title, due_iso, minutes, send_at });
          return { success: true };
        }

        if (sql.startsWith("INSERT INTO pending_notifications ")) {
          const [device_id, task_id, board_id, title, due_iso, minutes, created_at] = params as [
            string,
            string,
            string | null,
            string,
            string,
            number,
            number,
          ];
          db.pending.push({ id: db.pendingId++, device_id, task_id, board_id, title, due_iso, minutes, created_at });
          return { success: true };
        }

        if (sql.startsWith("DELETE FROM pending_notifications WHERE device_id = ?")) {
          const [deviceId] = params as [string];
          db.pending = db.pending.filter((p) => p.device_id !== deviceId);
          return { success: true };
        }

        if (sql.startsWith("DELETE FROM reminders WHERE device_id = ? AND reminder_key = ?")) {
          const [deviceId, reminderKey] = params as [string, string];
          db.reminders = db.reminders.filter((r) => !(r.device_id === deviceId && r.reminder_key === reminderKey));
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

        if (sql.startsWith("DELETE FROM devices WHERE device_id = ?")) {
          const [deviceId] = params as [string];
          db.devices.delete(deviceId);
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
        if (sql.includes("SELECT endpoint_hash") && sql.includes("FROM devices") && sql.includes("WHERE device_id = ?")) {
          const [deviceId] = params as [string];
          const d = db.devices.get(deviceId);
          return d ? ({ endpoint_hash: d.endpoint_hash } as any) : null;
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
    const out: any[] = [];
    for (const st of statements) {
      out.push(await st.run());
    }
    return out;
  }
}

function base64UrlEncode(buffer: Uint8Array): string {
  let s = "";
  for (const b of buffer) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function createVapidFixture() {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));

  const pemBody = btoa(String.fromCharCode(...pkcs8)).match(/.{1,64}/g)?.join("\n") ?? "";
  const privatePem = `-----BEGIN PRIVATE KEY-----\n${pemBody}\n-----END PRIVATE KEY-----`;

  const uncompressed = spki.slice(-65);
  const publicKey = base64UrlEncode(uncompressed);

  return { privatePem, publicKey };
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function makeEnv(db: MockD1) {
  const vapid = await createVapidFixture();
  return {
    ASSETS: {
      fetch: async () => new Response("asset", { status: 200 }),
    },
    TASKIFY_DB: db as any,
    VAPID_PUBLIC_KEY: vapid.publicKey,
    VAPID_PRIVATE_KEY: vapid.privatePem,
    VAPID_SUBJECT: "mailto:test@example.com",
  } as any;
}

test("GET /api/config returns worker origin and vapid key", async () => {
  const db = new MockD1();
  const env = await makeEnv(db);

  const req = new Request("https://taskify-v2.solife.me/api/config", { method: "GET" });
  const res = await worker.fetch(req, env);
  assert.equal(res.status, 200);
  const body = await res.json() as any;
  assert.equal(body.workerBaseUrl, "https://taskify-v2.solife.me");
  assert.equal(body.vapidPublicKey, env.VAPID_PUBLIC_KEY);
});

test("PUT /api/reminders returns 404 for unknown device", async () => {
  const db = new MockD1();
  const env = await makeEnv(db);

  const req = new Request("https://taskify-v2.solife.me/api/reminders", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deviceId: "missing", reminders: [] }),
  });

  const res = await worker.fetch(req, env);
  assert.equal(res.status, 404);
});

test("POST /api/reminders/poll returns pending notifications and drains them", async () => {
  const db = new MockD1();
  const env = await makeEnv(db);

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
  assert.equal(db.pending.length, 0);
});

test("scheduled due reminders send push ping with VAPID headers and enqueue pending", async () => {
  const db = new MockD1();
  const env = await makeEnv(db);

  const endpoint = "https://push.example/send";
  const endpointHash = await sha256Hex(endpoint);
  db.devices.set("dev-1", {
    device_id: "dev-1",
    platform: "ios",
    endpoint,
    endpoint_hash: endpointHash,
    subscription_auth: "auth",
    subscription_p256dh: "p256dh",
    updated_at: Date.now(),
  });
  db.reminders.push({
    device_id: "dev-1",
    reminder_key: "task-1:15",
    task_id: "task-1",
    board_id: "board-1",
    title: "Task A",
    due_iso: new Date(Date.now() + 60_000).toISOString(),
    minutes: 15,
    send_at: Date.now() - 1_000,
  });

  const originalFetch = globalThis.fetch;
  const pushCalls: Array<{ url: string; headers: Headers }> = [];
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    pushCalls.push({ url: String(url), headers });
    return new Response("", { status: 201 });
  }) as any;

  try {
    await worker.scheduled({ scheduledTime: Date.now(), cron: "* * * * *" } as any, env, undefined as any);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(pushCalls.length, 1);
  const call = pushCalls[0];
  assert.equal(call.url, endpoint);
  assert.match(call.headers.get("Authorization") || "", /^WebPush\s+/);
  assert.ok((call.headers.get("Crypto-Key") || "").includes("p256ecdsa="));
  assert.ok(Number(call.headers.get("TTL") || 0) >= 300);
  assert.equal(db.pending.length, 1);
  assert.equal(db.reminders.length, 0);
});

test("scheduled handles 410 by removing expired device", async () => {
  const db = new MockD1();
  const env = await makeEnv(db);

  const endpoint = "https://push.example/expired";
  const endpointHash = await sha256Hex(endpoint);
  db.devices.set("dev-expired", {
    device_id: "dev-expired",
    platform: "android",
    endpoint,
    endpoint_hash: endpointHash,
    subscription_auth: "auth",
    subscription_p256dh: "p256dh",
    updated_at: Date.now(),
  });
  db.reminders.push({
    device_id: "dev-expired",
    reminder_key: "task-z:5",
    task_id: "task-z",
    board_id: null,
    title: "Task Z",
    due_iso: new Date(Date.now() + 30_000).toISOString(),
    minutes: 5,
    send_at: Date.now() - 1_000,
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("gone", { status: 410 })) as any;

  try {
    await worker.scheduled({ scheduledTime: Date.now(), cron: "* * * * *" } as any, env, undefined as any);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(db.devices.has("dev-expired"), false, "expired device should be deleted");
  assert.equal(db.reminders.length, 0, "due reminder row should be consumed");
});
