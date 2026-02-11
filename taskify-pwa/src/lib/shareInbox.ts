import { secp256k1 } from "@noble/curves/secp256k1";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { finalizeEvent, getEventHash, getPublicKey, nip19, nip44, type Event as NostrEvent, type EventTemplate } from "nostr-tools";

import { normalizeNostrPubkey } from "./nostr";
import { TASKIFY_CALENDAR_EVENT_KIND, TASKIFY_CALENDAR_VIEW_KIND, parseCalendarAddress } from "./privateCalendar";
import { NostrSession } from "../nostr/NostrSession";
import { kvStorage } from "../storage/kvStorage";

export type SharedBoardPayload = {
  type: "board";
  boardId: string;
  boardName?: string;
  relays?: string[];
};

export type SharedContactPayload = {
  type: "contact";
  npub: string;
  name?: string;
  displayName?: string;
  username?: string;
  nip05?: string;
  lud16?: string;
  relays?: string[];
  about?: string;
  picture?: string;
  sender?: { npub?: string; name?: string };
};

export type SharedTaskPayload = {
  type: "task";
  title: string;
  note?: string;
  priority?: number;
  dueISO?: string;
  dueDateEnabled?: boolean;
  dueTimeEnabled?: boolean;
  dueTimeZone?: string;
  reminders?: Array<string | number>;
  subtasks?: { title: string; completed?: boolean }[];
  recurrence?: { type: string; [key: string]: unknown };
};

export type SharedCalendarEventInvitePayload = {
  type: "event";
  eventId: string;
  canonical: string;
  view: string;
  eventKey: string;
  inviteToken: string;
  title?: string;
  start?: string;
  end?: string;
  relays?: string[];
};

export type ShareEnvelope = {
  v: 1;
  kind: "taskify-share";
  item: SharedBoardPayload | SharedContactPayload | SharedTaskPayload | SharedCalendarEventInvitePayload;
  sender?: { npub?: string; name?: string };
};

function normalizeRelayList(list?: string[] | null): string[] | undefined {
  if (!Array.isArray(list)) return undefined;
  const relays = list
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
  return relays.length ? Array.from(new Set(relays)) : undefined;
}

function normalizeTaskDueISO(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

function normalizeTaskTimeZone(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: trimmed }).format();
    return trimmed;
  } catch {
    return undefined;
  }
}

function normalizeTaskPriority(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    const rounded = Math.round(value);
    if (rounded >= 1 && rounded <= 3) return rounded;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "!" || trimmed === "!!" || trimmed === "!!!") return trimmed.length;
    const parsed = Number.parseInt(trimmed, 10);
    if (parsed >= 1 && parsed <= 3) return parsed;
  }
  return undefined;
}

function normalizeTaskReminders(value: unknown): Array<string | number> | undefined {
  if (!Array.isArray(value)) return undefined;
  const reminders: Array<string | number> = [];
  value.forEach((entry) => {
    if (typeof entry === "string") {
      const trimmed = entry.trim();
      if (trimmed) reminders.push(trimmed);
      return;
    }
    if (typeof entry === "number" && Number.isFinite(entry)) {
      reminders.push(entry);
    }
  });
  return reminders.length ? reminders : undefined;
}

function normalizeTaskSubtasks(value: unknown): SharedTaskPayload["subtasks"] | undefined {
  if (!Array.isArray(value)) return undefined;
  const subtasks = value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const title = typeof (entry as any).title === "string" ? (entry as any).title.trim() : "";
      if (!title) return null;
      const completed = typeof (entry as any).completed === "boolean" ? (entry as any).completed : undefined;
      return completed === undefined ? { title } : { title, completed };
    })
    .filter((entry): entry is { title: string; completed?: boolean } => !!entry);
  return subtasks.length ? subtasks : undefined;
}

function normalizeTaskRecurrence(value: unknown): SharedTaskPayload["recurrence"] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const rawType = (value as any).type;
  if (typeof rawType !== "string" || !rawType.trim()) return undefined;
  return { ...(value as any), type: rawType.trim() };
}

export function buildBoardShareEnvelope(
  boardId: string,
  boardName?: string,
  relays?: string[],
  sender?: { npub?: string; name?: string },
): ShareEnvelope {
  return {
    v: 1,
    kind: "taskify-share",
    sender: sender?.npub || sender?.name ? sender : undefined,
    item: {
      type: "board",
      boardId: boardId.trim(),
      boardName: boardName?.trim() || undefined,
      relays: normalizeRelayList(relays),
    },
  };
}

export function buildContactShareEnvelope(payload: SharedContactPayload): ShareEnvelope {
  const npub = payload.npub.trim();
  return {
    v: 1,
    kind: "taskify-share",
    sender: payload.sender?.npub || payload.sender?.name ? payload.sender : undefined,
    item: {
      type: "contact",
      npub,
      relays: normalizeRelayList(payload.relays),
      // keep other fields optional/minimal to avoid oversized payloads; receiver can fetch profile later
      name: payload.name?.trim() || undefined,
      displayName: payload.displayName?.trim() || undefined,
      username: payload.username?.trim() || undefined,
      nip05: payload.nip05?.trim() || undefined,
      lud16: payload.lud16?.trim() || undefined,
    },
  };
}

export function buildTaskShareEnvelope(
  payload: SharedTaskPayload,
  sender?: { npub?: string; name?: string },
): ShareEnvelope {
  return {
    v: 1,
    kind: "taskify-share",
    sender: sender?.npub || sender?.name ? sender : undefined,
    item: {
      type: "task",
      title: payload.title.trim(),
      note: payload.note?.trim() || undefined,
      priority: normalizeTaskPriority(payload.priority),
      dueISO: normalizeTaskDueISO(payload.dueISO),
      dueDateEnabled: typeof payload.dueDateEnabled === "boolean" ? payload.dueDateEnabled : undefined,
      dueTimeEnabled: typeof payload.dueTimeEnabled === "boolean" ? payload.dueTimeEnabled : undefined,
      dueTimeZone: normalizeTaskTimeZone(payload.dueTimeZone),
      reminders: normalizeTaskReminders(payload.reminders),
      subtasks: normalizeTaskSubtasks(payload.subtasks),
      recurrence: normalizeTaskRecurrence(payload.recurrence),
    },
  };
}

function normalizeCalendarAddress(value: unknown, allowedKinds: number[]): string | null {
  if (typeof value !== "string") return null;
  const parsed = parseCalendarAddress(value);
  if (!parsed) return null;
  if (!allowedKinds.includes(parsed.kind)) return null;
  return `${parsed.kind}:${parsed.pubkey}:${parsed.d}`;
}

export function buildCalendarEventInviteEnvelope(
  payload: Omit<SharedCalendarEventInvitePayload, "type">,
  sender?: { npub?: string; name?: string },
): ShareEnvelope {
  const eventId = typeof payload.eventId === "string" ? payload.eventId.trim() : "";
  if (!eventId) {
    throw new Error("Invalid calendar event id.");
  }
  const canonical = normalizeCalendarAddress(payload.canonical, [TASKIFY_CALENDAR_EVENT_KIND]);
  const view = normalizeCalendarAddress(payload.view, [TASKIFY_CALENDAR_VIEW_KIND]);
  if (!canonical || !view) {
    throw new Error("Invalid calendar event address.");
  }
  const canonicalParsed = parseCalendarAddress(canonical);
  const viewParsed = parseCalendarAddress(view);
  if (!canonicalParsed || !viewParsed || canonicalParsed.d !== eventId || viewParsed.d !== eventId) {
    throw new Error("Calendar event address mismatch.");
  }
  if (canonicalParsed.pubkey !== viewParsed.pubkey) {
    throw new Error("Calendar event author mismatch.");
  }
  const eventKey = typeof payload.eventKey === "string" && payload.eventKey.trim() ? payload.eventKey.trim() : "";
  if (!eventKey) {
    throw new Error("Missing calendar event key.");
  }
  const inviteToken =
    typeof payload.inviteToken === "string" && payload.inviteToken.trim() ? payload.inviteToken.trim() : "";
  if (!inviteToken) {
    throw new Error("Missing calendar invite token.");
  }
  const title = typeof payload.title === "string" && payload.title.trim() ? payload.title.trim() : undefined;
  const start = typeof payload.start === "string" && payload.start.trim() ? payload.start.trim() : undefined;
  const end = typeof payload.end === "string" && payload.end.trim() ? payload.end.trim() : undefined;
  return {
    v: 1,
    kind: "taskify-share",
    sender: sender?.npub || sender?.name ? sender : undefined,
    item: {
      type: "event",
      eventId,
      canonical,
      view,
      eventKey,
      inviteToken,
      ...(title ? { title } : {}),
      ...(start ? { start } : {}),
      ...(end ? { end } : {}),
      relays: normalizeRelayList(payload.relays),
    },
  };
}

export function parseShareEnvelope(raw: string): ShareEnvelope | null {
  const trimmed = (raw || "").trim();
  if (!trimmed) return null;
  let parsed: any;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  if (parsed.v !== 1 || parsed.kind !== "taskify-share") return null;
  const item = parsed.item;
  if (!item || typeof item !== "object") return null;

  if (item.type === "board") {
    const boardId = typeof item.boardId === "string" ? item.boardId.trim() : "";
    if (!boardId) return null;
    const boardName = typeof item.boardName === "string" ? item.boardName.trim() : undefined;
    const relays = normalizeRelayList(item.relays);
    return {
      v: 1,
      kind: "taskify-share",
      item: { type: "board", boardId, boardName, relays },
      sender: sanitizeSender(parsed.sender),
    };
  }

  if (item.type === "contact") {
    const npubRaw = typeof item.npub === "string" ? item.npub.trim() : "";
    const npub = normalizeContactNpub(npubRaw);
    if (!npub) return null;
    const relays =
      Array.isArray(item.relays)
        ? normalizeRelayList(item.relays)
        : typeof item.relays === "string"
          ? normalizeRelayList(item.relays.split(","))
          : normalizeRelayList([]);
    const contact: SharedContactPayload = {
      type: "contact",
      npub,
      relays,
    };
    const stringFields: Array<keyof Omit<SharedContactPayload, "type" | "npub" | "relays">> = [
      "name",
      "displayName",
      "username",
      "nip05",
      "lud16",
      "about",
      "picture",
    ];
    stringFields.forEach((key) => {
      const value = (item as any)[key];
      if (typeof value === "string" && value.trim()) {
        (contact as any)[key] = value.trim();
      }
    });
    return {
      v: 1,
      kind: "taskify-share",
      item: contact,
      sender: sanitizeSender(parsed.sender),
    };
  }

  if (item.type === "task") {
    const title = typeof item.title === "string" ? item.title.trim() : "";
    if (!title) return null;
    const note = typeof item.note === "string" ? item.note.trim() : undefined;
    const priority = normalizeTaskPriority(item.priority);
    const dueISO = normalizeTaskDueISO(item.dueISO);
    const dueDateEnabled = typeof item.dueDateEnabled === "boolean" ? item.dueDateEnabled : undefined;
    const dueTimeEnabled = typeof item.dueTimeEnabled === "boolean" ? item.dueTimeEnabled : undefined;
    const dueTimeZone = normalizeTaskTimeZone(item.dueTimeZone);
    const reminders = normalizeTaskReminders(item.reminders);
    const subtasks = normalizeTaskSubtasks(item.subtasks);
    const recurrence = normalizeTaskRecurrence(item.recurrence);
    return {
      v: 1,
      kind: "taskify-share",
      item: {
        type: "task",
        title,
        note,
        priority,
        dueISO,
        dueDateEnabled,
        dueTimeEnabled,
        dueTimeZone,
        reminders,
        subtasks,
        recurrence,
      },
      sender: sanitizeSender(parsed.sender),
    };
  }

  if (item.type === "event") {
    const eventId = typeof item.eventId === "string" ? item.eventId.trim() : "";
    if (!eventId) return null;
    const canonical = normalizeCalendarAddress(item.canonical, [TASKIFY_CALENDAR_EVENT_KIND]);
    const view = normalizeCalendarAddress(item.view, [TASKIFY_CALENDAR_VIEW_KIND]);
    if (!canonical || !view) return null;
    const canonicalParsed = parseCalendarAddress(canonical);
    const viewParsed = parseCalendarAddress(view);
    if (!canonicalParsed || !viewParsed) return null;
    if (canonicalParsed.d !== eventId || viewParsed.d !== eventId) return null;
    if (canonicalParsed.pubkey !== viewParsed.pubkey) return null;
    const eventKey = typeof item.eventKey === "string" && item.eventKey.trim() ? item.eventKey.trim() : "";
    if (!eventKey) return null;
    const inviteToken =
      typeof item.inviteToken === "string" && item.inviteToken.trim() ? item.inviteToken.trim() : "";
    if (!inviteToken) return null;
    const title = typeof item.title === "string" && item.title.trim() ? item.title.trim() : undefined;
    const start = typeof item.start === "string" && item.start.trim() ? item.start.trim() : undefined;
    const end = typeof item.end === "string" && item.end.trim() ? item.end.trim() : undefined;
    const relays = normalizeRelayList(item.relays);
    return {
      v: 1,
      kind: "taskify-share",
      item: {
        type: "event",
        eventId,
        canonical,
        view,
        eventKey,
        inviteToken,
        ...(title ? { title } : {}),
        ...(start ? { start } : {}),
        ...(end ? { end } : {}),
        relays,
      },
      sender: sanitizeSender(parsed.sender),
    };
  }

  return null;
}

function sanitizeSender(sender: any): ShareEnvelope["sender"] {
  if (!sender || typeof sender !== "object") return undefined;
  const npub = typeof sender.npub === "string" && sender.npub.trim() ? sender.npub.trim() : undefined;
  const name = typeof sender.name === "string" && sender.name.trim() ? sender.name.trim() : undefined;
  if (!npub && !name) return undefined;
  return { npub, name };
}

function normalizeContactNpub(value: string): string | null {
  const normalized = normalizeNostrPubkey(value);
  if (normalized) return normalized;
  return value.startsWith("npub") ? value : null;
}

function toRawHexPubkey(value: string): string | null {
  const trimmed = (value || "").trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (/^(02|03)[0-9a-f]{64}$/.test(lower)) {
    return lower.slice(-64);
  }
  if (/^[0-9a-f]{64}$/.test(lower)) {
    return lower;
  }
  try {
    const decoded = nip19.decode(lower);
    if (decoded.type === "npub" && decoded.data) {
      if (typeof decoded.data === "string" && /^[0-9a-f]{64}$/.test(decoded.data)) {
        return decoded.data.toLowerCase();
      }
      if (decoded.data instanceof Uint8Array) {
        return bytesToHex(decoded.data).toLowerCase();
      }
      if (Array.isArray(decoded.data)) {
        return bytesToHex(new Uint8Array(decoded.data as number[])).toLowerCase();
      }
    }
  } catch {
    // fall through
  }
  return null;
}

function randomPastTimestampSeconds(maxOffsetSeconds = 2 * 24 * 60 * 60): number {
  const now = Math.floor(Date.now() / 1000);
  const offset = Math.floor(Math.random() * maxOffsetSeconds);
  return Math.max(0, now - offset);
}

function resolveNip17Timestamp(): number {
  try {
    const raw = kvStorage.getItem("taskify.nip17.timestamp") || "";
    if (raw.trim().toLowerCase() === "now") {
      return Math.floor(Date.now() / 1000);
    }
  } catch {
    // ignore storage access failures
  }
  return randomPastTimestampSeconds();
}

function generatePrivateKey(): { hex: string; bytes: Uint8Array } {
  const bytes = secp256k1.utils.randomPrivateKey();
  const hex = bytesToHex(bytes);
  return { hex, bytes: hexToBytes(hex) };
}

async function resolveRecipientInboxRelays(
  recipientHex: string,
  fallbackRelays: string[],
): Promise<string[]> {
  const normalizedFallback = Array.from(
    new Set(
      (fallbackRelays || [])
        .map((relay) => (typeof relay === "string" ? relay.trim() : ""))
        .filter(Boolean),
    ),
  );
  if (!normalizedFallback.length) return normalizedFallback;
  const normalizedRecipient = (recipientHex || "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalizedRecipient)) return normalizedFallback;
  try {
    const session = await NostrSession.init(normalizedFallback);
    const events = await session.fetchEvents(
      [{ kinds: [10050], authors: [normalizedRecipient] }],
      normalizedFallback,
    );
    const latest = Array.isArray(events)
      ? events.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))[0]
      : null;
    const inboxRelays = Array.isArray(latest?.tags)
      ? latest.tags
          .filter(
            (tag) =>
              Array.isArray(tag) &&
              tag[0] === "relay" &&
              typeof tag[1] === "string" &&
              tag[1].trim(),
          )
          .map((tag) => tag[1]!.trim())
      : [];
    return Array.from(new Set([...inboxRelays, ...normalizedFallback]));
  } catch {
    return normalizedFallback;
  }
}

export async function sendShareMessage(
  payload: ShareEnvelope,
  recipientPubkey: string,
  senderSecretHex: string,
  relays: string[] | string,
): Promise<void> {
  const recipientRaw = toRawHexPubkey(recipientPubkey);
  if (!recipientRaw) {
    throw new Error("Recipient npub is invalid.");
  }
  const relayList = toRelayList(relays);
  if (!relayList.length) {
    throw new Error("No relays configured for sending.");
  }
  const publishRelays = await resolveRecipientInboxRelays(recipientRaw, relayList);
  if (!publishRelays.length) {
    throw new Error("No relays configured for NIP-17 inbox.");
  }
  const session = await NostrSession.init(publishRelays);
  const publish = async (event: NostrEvent) => {
    await session.publishRaw(event, { relayUrls: publishRelays, returnEvent: false });
  };
  const content = JSON.stringify(payload);
  if (!nip44?.v2) {
    throw new Error("NIP-44 support is required to send share messages.");
  }
  const senderPubkey = getPublicKey(hexToBytes(senderSecretHex)).toLowerCase();
  const normalizedRecipient = recipientRaw.toLowerCase();
  const rumorBase = {
    kind: 14,
    content,
    tags: [["p", normalizedRecipient]],
    created_at: resolveNip17Timestamp(),
    pubkey: senderPubkey,
  };
  const rumor = {
    ...rumorBase,
    id: getEventHash(rumorBase),
  } satisfies Partial<NostrEvent>;
  const wrapRecipients = Array.from(new Set([normalizedRecipient, senderPubkey]));
  for (const wrapRecipient of wrapRecipients) {
    const dmKey = nip44.v2.utils.getConversationKey(senderSecretHex, wrapRecipient);
    const sealedContent = await nip44.v2.encrypt(JSON.stringify(rumor), dmKey);
    const sealTemplate: EventTemplate = {
      kind: 13,
      content: sealedContent,
      tags: [],
      created_at: resolveNip17Timestamp(),
    };
    const sealEvent = finalizeEvent(sealTemplate, hexToBytes(senderSecretHex));
    const wrapKey = generatePrivateKey();
    const wrapConversationKey = nip44.v2.utils.getConversationKey(wrapKey.hex, wrapRecipient);
    const wrapContent = await nip44.v2.encrypt(JSON.stringify(sealEvent), wrapConversationKey);
    const wrapTemplate: EventTemplate = {
      kind: 1059,
      content: wrapContent,
      tags: [["p", wrapRecipient]],
      created_at: resolveNip17Timestamp(),
    };
    const wrapEvent = finalizeEvent(wrapTemplate, wrapKey.bytes);
    await publish(wrapEvent);
  }
}
function toRelayList(input: unknown): string[] {
  let candidates: unknown[] = [];
  if (Array.isArray(input)) {
    candidates = input;
  } else if (typeof input === "string") {
    candidates = input.split(",");
  } else if (input && typeof input === "object" && (input as any)[Symbol.iterator]) {
    candidates = Array.from(input as Iterable<unknown>);
  }
  return Array.from(
    new Set(
      candidates
        .map((r) => (typeof r === "string" ? r.trim() : ""))
        .filter(Boolean),
    ),
  );
}
