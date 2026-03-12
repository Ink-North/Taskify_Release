import { secp256k1 } from "@noble/curves/secp256k1";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { finalizeEvent, getEventHash, getPublicKey, nip19, nip44, type Event as NostrEvent, type EventTemplate } from "nostr-tools";

import { normalizeNostrPubkey } from "./nostr";
import {
  buildBoardShareEnvelope as buildBoardShareEnvelopeCore,
  buildContactShareEnvelope as buildContactShareEnvelopeCore,
  buildTaskShareEnvelope as buildTaskShareEnvelopeCore,
  buildTaskAssignmentResponseEnvelope as buildTaskAssignmentResponseEnvelopeCore,
  buildCalendarEventInviteEnvelope as buildCalendarEventInviteEnvelopeCore,
  parseShareEnvelope as parseShareEnvelopeCore,
  type ShareEnvelope,
  type SharedBoardPayload,
  type SharedContactPayload,
  type SharedTaskPayload,
  type SharedCalendarEventInvitePayload,
  type SharedTaskAssignmentResponsePayload,
} from "taskify-core";
import { TASKIFY_CALENDAR_EVENT_KIND, TASKIFY_CALENDAR_VIEW_KIND, parseCalendarAddress } from "./privateCalendar";
import { NostrSession } from "../nostr/NostrSession";
import { kvStorage } from "../storage/kvStorage";


const SHARE_ENVELOPE_EMBED_MARKER = "Taskify-Share:";
const SHARE_ENVELOPE_EMBED_REGEX = /(?:^|\n)Taskify-Share:\s*([A-Za-z0-9_-]+)\s*(?:\n|$)/m;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array | null {
  try {
    const binary = atob(base64);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

function encodeBase64UrlUtf8(value: string): string {
  const base64 = bytesToBase64(new TextEncoder().encode(value));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64UrlUtf8(value: string): string | null {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const bytes = base64ToBytes(padded);
  if (!bytes) return null;
  try {
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

function formatTaskAssignmentPriority(priority: number | undefined): string | null {
  if (priority === 3) return "High";
  if (priority === 2) return "Medium";
  if (priority === 1) return "Low";
  return null;
}

function formatTaskAssignmentDue(task: SharedTaskPayload): string {
  if (task.dueDateEnabled === false) return "No due date";
  if (!task.dueISO) return "Not specified";
  const parsed = new Date(task.dueISO);
  if (Number.isNaN(parsed.getTime())) {
    return task.dueISO;
  }
  try {
    const options: Intl.DateTimeFormatOptions = task.dueTimeEnabled
      ? { dateStyle: "medium", timeStyle: "short", ...(task.dueTimeZone ? { timeZone: task.dueTimeZone } : {}) }
      : { dateStyle: "medium", ...(task.dueTimeZone ? { timeZone: task.dueTimeZone } : {}) };
    const formatted = new Intl.DateTimeFormat(undefined, options).format(parsed);
    return task.dueTimeZone ? `${formatted} (${task.dueTimeZone})` : formatted;
  } catch {
    return parsed.toISOString();
  }
}

function serializeTaskAssignmentShareEnvelope(payload: ShareEnvelope): string {
  const json = JSON.stringify(payload);
  if (payload.item.type !== "task" || payload.item.assignment !== true) {
    return json;
  }
  const task = payload.item;
  const lines: string[] = [
    "Task Assignment",
    "",
    `Title: ${task.title}`,
  ];
  const priority = formatTaskAssignmentPriority(task.priority);
  if (priority) {
    lines.push(`Priority: ${priority}`);
  }
  lines.push(`Due: ${formatTaskAssignmentDue(task)}`);
  const note = task.note?.trim();
  if (note) {
    lines.push("", "Details:", note);
  }
  const subtasks = (task.subtasks || [])
    .map((entry) => (typeof entry.title === "string" ? entry.title.trim().replace(/\s+/g, " ") : ""))
    .filter((title) => !!title);
  if (subtasks.length) {
    lines.push("", "Checklist:");
    subtasks.slice(0, 5).forEach((title) => {
      lines.push(`- ${title}`);
    });
    if (subtasks.length > 5) {
      lines.push(`- ...and ${subtasks.length - 5} more`);
    }
  }
  lines.push(
    "",
    "Open this in Taskify to accept, decline, or maybe.",
    "",
    `${SHARE_ENVELOPE_EMBED_MARKER} ${encodeBase64UrlUtf8(json)}`,
  );
  return lines.join("\n");
}

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

function normalizeTaskId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeTaskAssignmentStatus(
  value: unknown,
): "pending" | "accepted" | "declined" | "tentative" | undefined {
  if (value === "pending" || value === "accepted" || value === "declined" || value === "tentative") {
    return value;
  }
  if (value === "maybe") return "tentative";
  return undefined;
}

function normalizeTaskAssignees(value: unknown): SharedTaskPayload["assignees"] | undefined {
  if (!Array.isArray(value)) return undefined;
  const assignees: NonNullable<SharedTaskPayload["assignees"]> = [];
  const seen = new Set<string>();
  value.forEach((entry) => {
    if (!entry || typeof entry !== "object") return;
    const pubkey = toRawHexPubkey(typeof (entry as any).pubkey === "string" ? (entry as any).pubkey : "");
    if (!pubkey || seen.has(pubkey)) return;
    seen.add(pubkey);
    const relay = typeof (entry as any).relay === "string" ? (entry as any).relay.trim() : "";
    const status = normalizeTaskAssignmentStatus((entry as any).status);
    const respondedAtRaw = Number((entry as any).respondedAt);
    const respondedAt = Number.isFinite(respondedAtRaw) && respondedAtRaw > 0 ? Math.round(respondedAtRaw) : undefined;
    assignees.push({
      pubkey,
      ...(relay ? { relay } : {}),
      ...(status ? { status } : {}),
      ...(respondedAt ? { respondedAt } : {}),
    });
  });
  return assignees.length ? assignees : undefined;
}

function normalizeTaskAssignmentFlag(value: unknown): boolean | undefined {
  if (typeof value !== "boolean") return undefined;
  return value;
}

function normalizeTaskAssignmentResponseStatus(
  value: unknown,
): SharedTaskAssignmentResponsePayload["status"] | undefined {
  if (value === "accepted" || value === "declined" || value === "tentative") return value;
  if (value === "maybe") return "tentative";
  return undefined;
}

function normalizeTaskAssignmentResponseTime(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

export function buildBoardShareEnvelope(
  boardId: string,
  boardName?: string,
  relays?: string[],
  sender?: { npub?: string; name?: string },
): ShareEnvelope {
  return buildBoardShareEnvelopeCore(boardId, boardName, relays, sender);
}

export function buildContactShareEnvelope(payload: SharedContactPayload): ShareEnvelope {
  return buildContactShareEnvelopeCore(payload);
}

export function buildTaskShareEnvelope(
  payload: SharedTaskPayload,
  sender?: { npub?: string; name?: string },
): ShareEnvelope {
  return buildTaskShareEnvelopeCore(payload, sender);
}

export function buildTaskAssignmentResponseEnvelope(
  payload: Omit<SharedTaskAssignmentResponsePayload, "type">,
  sender?: { npub?: string; name?: string },
): ShareEnvelope {
  return buildTaskAssignmentResponseEnvelopeCore(payload, sender);
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
  return buildCalendarEventInviteEnvelopeCore(payload, sender);
}

export function parseShareEnvelope(raw: string): ShareEnvelope | null {
  return parseShareEnvelopeCore(raw);
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
      const decodedData: unknown = decoded.data;
      if (typeof decodedData === "string" && /^[0-9a-f]{64}$/.test(decodedData)) {
        return decodedData.toLowerCase();
      }
      if (decodedData instanceof Uint8Array) {
        return bytesToHex(decodedData).toLowerCase();
      }
      if (Array.isArray(decodedData)) {
        return bytesToHex(new Uint8Array(decodedData as number[])).toLowerCase();
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
  const content = serializeTaskAssignmentShareEnvelope(payload);
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
    const dmKey = nip44.v2.utils.getConversationKey(hexToBytes(senderSecretHex), wrapRecipient);
    const sealedContent = await nip44.v2.encrypt(JSON.stringify(rumor), dmKey);
    const sealTemplate: EventTemplate = {
      kind: 13,
      content: sealedContent,
      tags: [],
      created_at: resolveNip17Timestamp(),
    };
    const sealEvent = finalizeEvent(sealTemplate, hexToBytes(senderSecretHex));
    const wrapKey = generatePrivateKey();
    const wrapConversationKey = nip44.v2.utils.getConversationKey(hexToBytes(wrapKey.hex), wrapRecipient);
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
