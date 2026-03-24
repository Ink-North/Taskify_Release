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

test("scheduled batches multiple devices and sends one push per device", async () => {
  const db = new MockD1();
  const env = await makeEnv(db);

  const endpointA = "https://push.example/a";
  const endpointB = "https://push.example/b";
  db.devices.set("dev-a", {
    device_id: "dev-a",
    platform: "ios",
    endpoint: endpointA,
    endpoint_hash: await sha256Hex(endpointA),
    subscription_auth: "auth-a",
    subscription_p256dh: "p256dh-a",
    updated_at: Date.now(),
  });
  db.devices.set("dev-b", {
    device_id: "dev-b",
    platform: "android",
    endpoint: endpointB,
    endpoint_hash: await sha256Hex(endpointB),
    subscription_auth: "auth-b",
    subscription_p256dh: "p256dh-b",
    updated_at: Date.now(),
  });

  const now = Date.now();
  db.reminders.push(
    {
      device_id: "dev-a",
      reminder_key: "a1:15",
      task_id: "a1",
      board_id: "board-a",
      title: "A1",
      due_iso: new Date(now + 120_000).toISOString(),
      minutes: 15,
      send_at: now - 1_000,
    },
    {
      device_id: "dev-a",
      reminder_key: "a2:5",
      task_id: "a2",
      board_id: "board-a",
      title: "A2",
      due_iso: new Date(now + 180_000).toISOString(),
      minutes: 5,
      send_at: now - 500,
    },
    {
      device_id: "dev-b",
      reminder_key: "b1:10",
      task_id: "b1",
      board_id: "board-b",
      title: "B1",
      due_iso: new Date(now + 90_000).toISOString(),
      minutes: 10,
      send_at: now - 700,
    },
  );

  const originalFetch = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (url: RequestInfo | URL) => {
    urls.push(String(url));
    return new Response("", { status: 201 });
  }) as any;

  try {
    await worker.scheduled({ scheduledTime: Date.now(), cron: "* * * * *" } as any, env, undefined as any);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(urls.length, 2, "one push ping per device");
  assert.ok(urls.includes(endpointA));
  assert.ok(urls.includes(endpointB));

  const pendingA = db.pending.filter((p) => p.device_id === "dev-a");
  const pendingB = db.pending.filter((p) => p.device_id === "dev-b");
  assert.equal(pendingA.length, 2, "all dev-a due reminders should be pending");
  assert.equal(pendingB.length, 1, "all dev-b due reminders should be pending");
  assert.equal(db.reminders.length, 0, "all processed due reminders should be removed");
});

// ─────────────────────────────────────────────────────────────────────────────
// Voice dictation endpoint tests
// These tests are EXPECTED TO FAIL until the implementation is added.
// ─────────────────────────────────────────────────────────────────────────────

// Extend MockD1 to support voice_quota table.
// We patch MockD1's prepare() to handle voice_quota queries inline by
// checking for the table name in the SQL string.
//
// Rather than modifying MockD1 above (shared with existing tests), we create
// a subclass used only for voice tests.
class MockD1WithVoice extends MockD1 {
  // key: `${npub}:${date}`
  quota = new Map<string, { session_count: number; total_seconds: number }>();

  override prepare(query: string) {
    const base = super.prepare(query);
    const sql = query.replace(/\s+/g, " ").trim();
    const db = this;

    // For voice_quota queries, intercept first() and run()
    if (!sql.toLowerCase().includes("voice_quota")) {
      return base;
    }

    let params: unknown[] = [];

    return {
      _sql: sql,
      bind(...values: unknown[]) {
        params = values;
        return this;
      },
      async run() {
        // CREATE TABLE
        if (/^CREATE TABLE/i.test(sql)) return { success: true };

        // INSERT ... ON CONFLICT DO UPDATE (upsert quota)
        if (/^INSERT INTO voice_quota/i.test(sql)) {
          const [npub, date, , addSeconds] = params as [string, string, number, number];
          const key = `${npub}:${date}`;
          const existing = db.quota.get(key) ?? { session_count: 0, total_seconds: 0 };
          db.quota.set(key, {
            session_count: existing.session_count + 1,
            total_seconds: existing.total_seconds + (addSeconds as number),
          });
          return { success: true };
        }

        return { success: true };
      },
      async first() {
        // SELECT * FROM voice_quota WHERE npub=? AND date=?
        if (/SELECT .* FROM voice_quota/i.test(sql)) {
          const [npub, date] = params as [string, string];
          const row = db.quota.get(`${npub}:${date}`);
          if (!row) return null;
          return { npub, date, ...row } as any;
        }
        return null;
      },
      async all() {
        return { success: true, results: [] };
      },
    };
  }
}

async function makeVoiceEnv(db: MockD1WithVoice, geminiApiKey = "fake-gemini-key") {
  const base = await makeEnv(db);
  return { ...base, GEMINI_API_KEY: geminiApiKey } as any;
}

// ── Test 1: POST /api/voice/extract — returns 501 when GEMINI_API_KEY missing ─
test("POST /api/voice/extract returns 501 when GEMINI_API_KEY not configured", async () => {
  const db = new MockD1WithVoice();
  const env = await makeEnv(db); // no GEMINI_API_KEY

  const req = new Request("https://taskify-v2.solife.me/api/voice/extract", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ npub: "npub1abc", transcript: "call dentist tomorrow", sessionDurationSeconds: 5 }),
  });
  const res = await worker.fetch(req, env);
  assert.equal(res.status, 501, "should be 501 when GEMINI_API_KEY absent");
  const body = await res.json() as any;
  assert.ok(body.error, "should have error field");
});

// ── Test 2: POST /api/voice/extract — 400 on missing npub ─────────────────────
test("POST /api/voice/extract returns 400 when npub is missing", async () => {
  const db = new MockD1WithVoice();
  const env = await makeVoiceEnv(db);

  const req = new Request("https://taskify-v2.solife.me/api/voice/extract", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ transcript: "call dentist tomorrow", sessionDurationSeconds: 5 }),
  });
  const res = await worker.fetch(req, env);
  assert.equal(res.status, 400);
  const body = await res.json() as any;
  assert.ok(body.error);
});

// ── Test 3: POST /api/voice/extract — 400 on empty transcript ─────────────────
test("POST /api/voice/extract returns 400 when transcript is empty", async () => {
  const db = new MockD1WithVoice();
  const env = await makeVoiceEnv(db);

  const req = new Request("https://taskify-v2.solife.me/api/voice/extract", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ npub: "npub1abc", transcript: "   ", sessionDurationSeconds: 0 }),
  });
  const res = await worker.fetch(req, env);
  assert.equal(res.status, 400);
  const body = await res.json() as any;
  assert.ok(body.error);
});

// ── Test 4: POST /api/voice/extract — happy path: calls Gemini, returns operations ─
test("POST /api/voice/extract calls Gemini and returns operations on success", async () => {
  const db = new MockD1WithVoice();
  const env = await makeVoiceEnv(db);

  const geminiOperations = [
    { type: "create_task", title: "Call dentist", dueText: "tomorrow" },
  ];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: RequestInfo | URL) => {
    if (String(url).includes("generativelanguage.googleapis.com")) {
      return new Response(
        JSON.stringify({
          candidates: [
            { content: { parts: [{ text: JSON.stringify({ operations: geminiOperations }) }] } },
          ],
        }),
        { status: 200 },
      );
    }
    return new Response("", { status: 200 });
  }) as any;

  try {
    const req = new Request("https://taskify-v2.solife.me/api/voice/extract", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        npub: "npub1abc",
        transcript: "call dentist tomorrow",
        candidates: [],
        sessionDurationSeconds: 10,
      }),
    });
    const res = await worker.fetch(req, env);
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.ok(Array.isArray(body.operations), "should have operations array");
    assert.equal(body.operations.length, 1);
    assert.equal(body.operations[0].type, "create_task");
    assert.equal(body.operations[0].title, "Call dentist");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ── Test 5: POST /api/voice/extract — quota is incremented after successful call ─
test("POST /api/voice/extract increments quota after successful Gemini call", async () => {
  const db = new MockD1WithVoice();
  const env = await makeVoiceEnv(db);
  const npub = "npub1quotatest";
  const date = new Date().toISOString().slice(0, 10);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: RequestInfo | URL) => {
    if (String(url).includes("generativelanguage.googleapis.com")) {
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: JSON.stringify({ operations: [] }) }] } }],
        }),
        { status: 200 },
      );
    }
    return new Response("", { status: 200 });
  }) as any;

  try {
    const req = new Request("https://taskify-v2.solife.me/api/voice/extract", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ npub, transcript: "hello world", candidates: [], sessionDurationSeconds: 15 }),
    });
    await worker.fetch(req, env);
    const row = db.quota.get(`${npub}:${date}`);
    assert.ok(row, "quota row should exist");
    assert.equal(row!.session_count, 1);
    assert.equal(row!.total_seconds, 15);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ── Test 6: POST /api/voice/extract — returns 429 + fallback when quota exceeded ─
test("POST /api/voice/extract returns 429 with fallback operations when quota exceeded", async () => {
  const db = new MockD1WithVoice();
  const env = await makeVoiceEnv(db);
  const npub = "npub1overquota";
  const date = new Date().toISOString().slice(0, 10);

  // Pre-seed quota at limit
  db.quota.set(`${npub}:${date}`, { session_count: 5, total_seconds: 300 });

  const req = new Request("https://taskify-v2.solife.me/api/voice/extract", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ npub, transcript: "call dentist and pick up groceries", sessionDurationSeconds: 10 }),
  });
  const res = await worker.fetch(req, env);
  assert.equal(res.status, 429);
  const body = await res.json() as any;
  assert.equal(body.error, "quota_exceeded");
  assert.ok(Array.isArray(body.operations), "should include fallback operations");
  // Rule-based fallback: "call dentist" and "pick up groceries"
  assert.ok(body.operations.length >= 1, "at least one fallback operation");
  assert.ok(body.operations.every((op: any) => op.type === "create_task"));
});

// ── Test 7: POST /api/voice/extract — Gemini failure → rule-based fallback (200) ─
test("POST /api/voice/extract returns rule-based fallback operations when Gemini fails", async () => {
  const db = new MockD1WithVoice();
  const env = await makeVoiceEnv(db);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("error", { status: 503 })) as any;

  try {
    const req = new Request("https://taskify-v2.solife.me/api/voice/extract", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        npub: "npub1abc",
        transcript: "call dentist, pick up groceries",
        candidates: [],
        sessionDurationSeconds: 8,
      }),
    });
    const res = await worker.fetch(req, env);
    assert.equal(res.status, 200, "should return 200 with fallback even on Gemini failure");
    const body = await res.json() as any;
    assert.ok(Array.isArray(body.operations));
    assert.ok(body.operations.length >= 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ── Test 8: POST /api/voice/finalize — 501 when GEMINI_API_KEY missing ──────────
test("POST /api/voice/finalize returns 501 when GEMINI_API_KEY not configured", async () => {
  const db = new MockD1WithVoice();
  const env = await makeEnv(db); // no key

  const req = new Request("https://taskify-v2.solife.me/api/voice/finalize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      npub: "npub1abc",
      candidates: [{ id: "1", title: "Call dentist", dueText: "tomorrow", status: "confirmed" }],
      referenceDate: new Date().toISOString(),
    }),
  });
  const res = await worker.fetch(req, env);
  assert.equal(res.status, 501);
});

// ── Test 9: POST /api/voice/finalize — 400 when no confirmed candidates ─────────
test("POST /api/voice/finalize returns 400 when candidates array has no confirmed tasks", async () => {
  const db = new MockD1WithVoice();
  const env = await makeVoiceEnv(db);

  const req = new Request("https://taskify-v2.solife.me/api/voice/finalize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      npub: "npub1abc",
      candidates: [
        { id: "1", title: "Call dentist", status: "dismissed" },
        { id: "2", title: "Groceries", status: "draft" },
      ],
      referenceDate: new Date().toISOString(),
    }),
  });
  const res = await worker.fetch(req, env);
  assert.equal(res.status, 400);
  const body = await res.json() as any;
  assert.ok(body.error);
});

// ── Test 10: POST /api/voice/finalize — happy path: returns normalized tasks ────
test("POST /api/voice/finalize returns normalized FinalTask array from confirmed candidates", async () => {
  const db = new MockD1WithVoice();
  const env = await makeVoiceEnv(db);

  const referenceDate = "2026-03-24T18:00:00.000Z";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: RequestInfo | URL) => {
    if (String(url).includes("generativelanguage.googleapis.com")) {
      // Simulate Gemini normalizing the task
      return new Response(
        JSON.stringify({
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify({
                  tasks: [
                    {
                      id: "c1",
                      title: "Call Dentist",
                      dueISO: "2026-03-25T14:00:00.000Z",
                      subtasks: [],
                      notes: null,
                      boardId: null,
                      priority: null,
                    },
                  ],
                }),
              }],
            },
          }],
        }),
        { status: 200 },
      );
    }
    return new Response("", { status: 200 });
  }) as any;

  try {
    const req = new Request("https://taskify-v2.solife.me/api/voice/finalize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        npub: "npub1abc",
        candidates: [
          { id: "c1", title: "call dentist", dueText: "tomorrow 2pm", status: "confirmed" },
          { id: "c2", title: "pick up groceries", status: "dismissed" }, // should be excluded
        ],
        boardId: "board-xyz",
        referenceDate,
      }),
    });
    const res = await worker.fetch(req, env);
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.ok(Array.isArray(body.tasks), "should have tasks array");
    assert.equal(body.tasks.length, 1, "only confirmed candidates returned");
    assert.equal(body.tasks[0].title, "Call Dentist");
    assert.equal(body.tasks[0].dueISO, "2026-03-25T14:00:00.000Z");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ── Test 11: POST /api/voice/finalize — Gemini failure returns title-only tasks ─
test("POST /api/voice/finalize returns tasks with title-only when Gemini fails (no 500)", async () => {
  const db = new MockD1WithVoice();
  const env = await makeVoiceEnv(db);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("error", { status: 503 })) as any;

  try {
    const req = new Request("https://taskify-v2.solife.me/api/voice/finalize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        npub: "npub1abc",
        candidates: [
          { id: "c1", title: "call dentist", dueText: "tomorrow", status: "confirmed" },
        ],
        referenceDate: new Date().toISOString(),
      }),
    });
    const res = await worker.fetch(req, env);
    assert.equal(res.status, 200, "must not 500 on Gemini failure");
    const body = await res.json() as any;
    assert.ok(Array.isArray(body.tasks));
    assert.equal(body.tasks.length, 1);
    assert.ok(body.tasks[0].title, "should still have title");
    assert.equal(body.tasks[0].dueISO, undefined, "no dueISO when Gemini fails");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("POST /api/voice/finalize falls back to parse dueText time phrases when Gemini fails", async () => {
  const db = new MockD1WithVoice();
  const env = await makeVoiceEnv(db);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("error", { status: 503 })) as any;

  try {
    const req = new Request("https://taskify-v2.solife.me/api/voice/finalize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        npub: "npub1abc",
        candidates: [
          { id: "c1", title: "Ashley's birthday party", dueText: "tomorrow at 2 PM", status: "confirmed" },
          { id: "c2", title: "Go for a walk", dueText: "Friday at noon", status: "confirmed" },
        ],
        referenceDate: "2026-03-24T18:00:00.000Z",
      }),
    });
    const res = await worker.fetch(req, env);
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.ok(Array.isArray(body.tasks));
    assert.equal(body.tasks.length, 2);
    assert.equal(body.tasks[0].dueISO, "2026-03-25T19:00:00.000Z");
    assert.equal(body.tasks[1].dueISO, "2026-03-27T17:00:00.000Z");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
