import { sha256 } from "@noble/hashes/sha256";
import { nip44 } from "nostr-tools";

export const TASKIFY_CALENDAR_EVENT_KIND = 30310;
export const TASKIFY_CALENDAR_VIEW_KIND = 30311;
export const TASKIFY_CALENDAR_RSVP_KIND = 30312;

export type CalendarRsvpStatus = "accepted" | "declined" | "tentative";
export type CalendarRsvpFb = "free" | "busy";

export type CalendarParticipant = {
  pubkey: string;
  relay?: string;
  role?: string;
};

export type CalendarCanonicalPayload = {
  v: 1;
  eventId: string;
  eventKey: string;
  kind?: "date" | "time";
  title?: string;
  summary?: string;
  description?: string;
  documents?: unknown[];
  image?: string;
  locations?: string[];
  geohash?: string;
  participants?: CalendarParticipant[];
  hashtags?: string[];
  references?: string[];
  startDate?: string;
  endDate?: string;
  startISO?: string;
  endISO?: string;
  startTzid?: string;
  endTzid?: string;
  inviteTokens?: Record<string, string>;
  deleted?: boolean;
};

export type CalendarViewPayload = {
  v: 1;
  eventId: string;
  kind?: "date" | "time";
  title?: string;
  summary?: string;
  description?: string;
  documents?: unknown[];
  image?: string;
  locations?: string[];
  geohash?: string;
  hashtags?: string[];
  references?: string[];
  startDate?: string;
  endDate?: string;
  startISO?: string;
  endISO?: string;
  startTzid?: string;
  endTzid?: string;
  deleted?: boolean;
};

export type CalendarRsvpPayload = {
  v: 1;
  eventId: string;
  status: CalendarRsvpStatus;
  inviteToken: string;
  fb?: CalendarRsvpFb;
  note?: string;
};

function ensureNip44V2() {
  if (!nip44?.v2) {
    throw new Error("NIP-44 v2 encryption is unavailable.");
  }
  return nip44.v2;
}

function bytesToBase64(bytes: Uint8Array): string {
  const Buf = (globalThis as any).Buffer;
  if (Buf) {
    return Buf.from(bytes).toString("base64");
  }
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

const BOARD_RSVP_TOKEN_LABEL = new TextEncoder().encode("taskify-board-rsvp-token-v1");

export function deriveBoardRsvpToken(boardId: string, attendeePubkey: string): string {
  const normalizedBoardId = (boardId || "").trim();
  const normalizedPubkey = (attendeePubkey || "").trim().toLowerCase();
  const material = concatBytes(
    BOARD_RSVP_TOKEN_LABEL,
    new TextEncoder().encode(`${normalizedBoardId}:${normalizedPubkey}`),
  );
  const digest = sha256(material);
  return bytesToBase64(digest);
}

function base64ToBytes(base64: string): Uint8Array {
  const Buf = (globalThis as any).Buffer;
  if (Buf) {
    return new Uint8Array(Buf.from(base64, "base64"));
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
  return out.length ? out : undefined;
}

function normalizeParticipants(value: unknown): CalendarParticipant[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: CalendarParticipant[] = [];
  value.forEach((entry) => {
    if (!entry || typeof entry !== "object") return;
    const pubkey = normalizeString((entry as any).pubkey);
    if (!pubkey || !/^[0-9a-f]{64}$/i.test(pubkey)) return;
    const relay = normalizeString((entry as any).relay) || undefined;
    const role = normalizeString((entry as any).role) || undefined;
    out.push({ pubkey: pubkey.toLowerCase(), ...(relay ? { relay } : {}), ...(role ? { role } : {}) });
  });
  return out.length ? out : undefined;
}

function normalizeInviteTokens(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const out: Record<string, string> = {};
  Object.entries(value as Record<string, unknown>).forEach(([key, token]) => {
    if (!/^[0-9a-f]{64}$/i.test(key)) return;
    if (typeof token !== "string" || !token.trim()) return;
    out[key.toLowerCase()] = token.trim();
  });
  return Object.keys(out).length ? out : undefined;
}

export function calendarAddress(kind: number, pubkey: string, d: string): string {
  return `${kind}:${pubkey}:${d}`;
}

export function parseCalendarAddress(coord: string): { kind: number; pubkey: string; d: string } | null {
  if (typeof coord !== "string") return null;
  const trimmed = coord.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(":");
  if (parts.length < 3) return null;
  const kind = Number(parts[0]);
  if (!Number.isFinite(kind)) return null;
  const pubkey = (parts[1] || "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(pubkey)) return null;
  const d = parts.slice(2).join(":").trim();
  if (!d) return null;
  return { kind, pubkey, d };
}

export function generateEventKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return bytesToBase64(bytes);
}

export function generateInviteToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return bytesToBase64(bytes);
}

function eventKeyToBytes(eventKey: string): Uint8Array | null {
  const trimmed = eventKey.trim();
  if (!trimmed) return null;
  try {
    const bytes = base64ToBytes(trimmed);
    return bytes.length === 32 ? bytes : null;
  } catch {
    return null;
  }
}

export async function encryptCalendarPayloadForBoard(
  payload: unknown,
  boardSkHex: string,
  boardPk: string,
): Promise<string> {
  const nip44v2 = ensureNip44V2();
  const conversationKey = nip44v2.utils.getConversationKey(boardSkHex, boardPk);
  return nip44v2.encrypt(JSON.stringify(payload), conversationKey);
}

export async function decryptCalendarPayloadForBoard(
  content: string,
  boardSkHex: string,
  boardPk: string,
): Promise<unknown> {
  const nip44v2 = ensureNip44V2();
  const conversationKey = nip44v2.utils.getConversationKey(boardSkHex, boardPk);
  const plaintext = await nip44v2.decrypt(content, conversationKey);
  return JSON.parse(plaintext);
}

export async function encryptCalendarPayloadWithEventKey(payload: unknown, eventKey: string): Promise<string> {
  const nip44v2 = ensureNip44V2();
  const keyBytes = eventKeyToBytes(eventKey);
  if (!keyBytes) throw new Error("Invalid event key.");
  return nip44v2.encrypt(JSON.stringify(payload), keyBytes);
}

export async function decryptCalendarPayloadWithEventKey(content: string, eventKey: string): Promise<unknown> {
  const nip44v2 = ensureNip44V2();
  const keyBytes = eventKeyToBytes(eventKey);
  if (!keyBytes) throw new Error("Invalid event key.");
  const plaintext = await nip44v2.decrypt(content, keyBytes);
  return JSON.parse(plaintext);
}

export async function encryptCalendarRsvpPayload(
  payload: unknown,
  attendeeSkHex: string,
  boardPubkey: string,
): Promise<string> {
  const nip44v2 = ensureNip44V2();
  const conversationKey = nip44v2.utils.getConversationKey(attendeeSkHex, boardPubkey);
  return nip44v2.encrypt(JSON.stringify(payload), conversationKey);
}

export async function decryptCalendarRsvpPayload(
  content: string,
  boardSkHex: string,
  attendeePubkey: string,
): Promise<unknown> {
  const nip44v2 = ensureNip44V2();
  const conversationKey = nip44v2.utils.getConversationKey(boardSkHex, attendeePubkey);
  const plaintext = await nip44v2.decrypt(content, conversationKey);
  return JSON.parse(plaintext);
}

export async function decryptCalendarRsvpPayloadForAttendee(
  content: string,
  attendeeSkHex: string,
  boardPubkey: string,
): Promise<unknown> {
  const nip44v2 = ensureNip44V2();
  const conversationKey = nip44v2.utils.getConversationKey(attendeeSkHex, boardPubkey);
  const plaintext = await nip44v2.decrypt(content, conversationKey);
  return JSON.parse(plaintext);
}

export function parseCalendarCanonicalPayload(raw: unknown): CalendarCanonicalPayload | null {
  if (!raw || typeof raw !== "object") return null;
  if ((raw as any).v !== 1) return null;
  const eventId = normalizeString((raw as any).eventId);
  const eventKey = normalizeString((raw as any).eventKey);
  if (!eventId || !eventKey) return null;
  const deleted = (raw as any).deleted === true;
  const kindRaw = (raw as any).kind;
  const kind = kindRaw === "date" || kindRaw === "time" ? kindRaw : undefined;
  const title = normalizeString((raw as any).title);
  if (!deleted) {
    if (!kind || !title) return null;
  }
  const payload: CalendarCanonicalPayload = {
    v: 1,
    eventId,
    eventKey,
    ...(deleted ? { deleted: true } : {}),
    ...(kind ? { kind } : {}),
    ...(title ? { title } : {}),
  };
  const summary = normalizeString((raw as any).summary);
  if (summary) payload.summary = summary;
  const description = normalizeString((raw as any).description);
  if (description) payload.description = description;
  if (Array.isArray((raw as any).documents) && (raw as any).documents.length) {
    payload.documents = (raw as any).documents;
  }
  const image = normalizeString((raw as any).image);
  if (image) payload.image = image;
  const geohash = normalizeString((raw as any).geohash);
  if (geohash) payload.geohash = geohash;
  const locations = normalizeStringArray((raw as any).locations);
  if (locations) payload.locations = locations;
  const hashtags = normalizeStringArray((raw as any).hashtags);
  if (hashtags) payload.hashtags = hashtags;
  const references = normalizeStringArray((raw as any).references);
  if (references) payload.references = references;
  const participants = normalizeParticipants((raw as any).participants);
  if (participants) payload.participants = participants;
  const inviteTokens = normalizeInviteTokens((raw as any).inviteTokens);
  if (inviteTokens) payload.inviteTokens = inviteTokens;
  const startDate = normalizeString((raw as any).startDate);
  if (startDate) payload.startDate = startDate;
  const endDate = normalizeString((raw as any).endDate);
  if (endDate) payload.endDate = endDate;
  const startISO = normalizeString((raw as any).startISO);
  if (startISO) payload.startISO = startISO;
  const endISO = normalizeString((raw as any).endISO);
  if (endISO) payload.endISO = endISO;
  const startTzid = normalizeString((raw as any).startTzid);
  if (startTzid) payload.startTzid = startTzid;
  const endTzid = normalizeString((raw as any).endTzid);
  if (endTzid) payload.endTzid = endTzid;
  if (!deleted) {
    if (payload.kind === "date" && !payload.startDate) return null;
    if (payload.kind === "time" && !payload.startISO) return null;
  }
  return payload;
}

export function parseCalendarViewPayload(raw: unknown): CalendarViewPayload | null {
  if (!raw || typeof raw !== "object") return null;
  if ((raw as any).v !== 1) return null;
  const eventId = normalizeString((raw as any).eventId);
  if (!eventId) return null;
  const deleted = (raw as any).deleted === true;
  const kindRaw = (raw as any).kind;
  const kind = kindRaw === "date" || kindRaw === "time" ? kindRaw : undefined;
  const title = normalizeString((raw as any).title);
  if (!deleted) {
    if (!kind || !title) return null;
  }
  const payload: CalendarViewPayload = {
    v: 1,
    eventId,
    ...(deleted ? { deleted: true } : {}),
    ...(kind ? { kind } : {}),
    ...(title ? { title } : {}),
  };
  const summary = normalizeString((raw as any).summary);
  if (summary) payload.summary = summary;
  const description = normalizeString((raw as any).description);
  if (description) payload.description = description;
  if (Array.isArray((raw as any).documents) && (raw as any).documents.length) {
    payload.documents = (raw as any).documents;
  }
  const image = normalizeString((raw as any).image);
  if (image) payload.image = image;
  const geohash = normalizeString((raw as any).geohash);
  if (geohash) payload.geohash = geohash;
  const locations = normalizeStringArray((raw as any).locations);
  if (locations) payload.locations = locations;
  const hashtags = normalizeStringArray((raw as any).hashtags);
  if (hashtags) payload.hashtags = hashtags;
  const references = normalizeStringArray((raw as any).references);
  if (references) payload.references = references;
  const startDate = normalizeString((raw as any).startDate);
  if (startDate) payload.startDate = startDate;
  const endDate = normalizeString((raw as any).endDate);
  if (endDate) payload.endDate = endDate;
  const startISO = normalizeString((raw as any).startISO);
  if (startISO) payload.startISO = startISO;
  const endISO = normalizeString((raw as any).endISO);
  if (endISO) payload.endISO = endISO;
  const startTzid = normalizeString((raw as any).startTzid);
  if (startTzid) payload.startTzid = startTzid;
  const endTzid = normalizeString((raw as any).endTzid);
  if (endTzid) payload.endTzid = endTzid;
  if (!deleted) {
    if (payload.kind === "date" && !payload.startDate) return null;
    if (payload.kind === "time" && !payload.startISO) return null;
  }
  return payload;
}

export function parseCalendarRsvpPayload(raw: unknown): CalendarRsvpPayload | null {
  if (!raw || typeof raw !== "object") return null;
  if ((raw as any).v !== 1) return null;
  const eventId = normalizeString((raw as any).eventId);
  if (!eventId) return null;
  const inviteToken = normalizeString((raw as any).inviteToken);
  if (!inviteToken) return null;
  const statusRaw = (raw as any).status;
  const status =
    statusRaw === "accepted" || statusRaw === "declined" || statusRaw === "tentative"
      ? (statusRaw as CalendarRsvpStatus)
      : null;
  if (!status) return null;
  const payload: CalendarRsvpPayload = { v: 1, eventId, status, inviteToken };
  const fbRaw = (raw as any).fb;
  if (fbRaw === "free" || fbRaw === "busy") {
    payload.fb = fbRaw as CalendarRsvpFb;
  }
  const note = normalizeString((raw as any).note);
  if (note) payload.note = note;
  return payload;
}
