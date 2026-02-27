import { nip19 } from "nostr-tools";

import { LS_LIGHTNING_CONTACTS } from "../localStorageKeys";
import { idbKeyValue } from "../storage/idbKeyValue";
import { TASKIFY_STORE_NOSTR } from "../storage/taskifyDb";
import { normalizeNostrPubkey } from "./nostr";

export type ContactProfile = {
  username?: string;
  displayName?: string;
  about?: string;
  picture?: string;
  lud16?: string;
  nip05?: string;
  paymentRequest?: string;
  creq?: string;
  relays?: string[];
};

export type ContactKind = "nostr" | "custom";

export type Contact = {
  id: string;
  kind: ContactKind;
  name: string;
  address: string;
  paymentRequest: string;
  npub: string;
  username?: string;
  displayName?: string;
  nip05?: string;
  about?: string;
  picture?: string;
  relays?: string[];
  createdAt?: number;
  updatedAt?: number;
  source?: "manual" | "profile" | "scan" | "sync";
};

export type ContactSyncEntry = {
  id: string;
  kind: ContactKind;
  npub?: string;
  relays?: string[];
  name?: string;
  username?: string;
  displayName?: string;
  lud16?: string;
  nip05?: string;
  paymentRequest?: string;
  creq?: string;
  about?: string;
  picture?: string;
};

export type ContactSyncEnvelope = {
  version: 1;
  updatedAt: number;
  contacts: ContactSyncEntry[];
};

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function sanitizeUsername(value: string): string {
  return value.replace(/\s+/g, "").replace(/^@+/, "").trim();
}

export function formatContactUsername(username?: string): string {
  const sanitized = sanitizeUsername(username || "");
  return sanitized ? `@${sanitized}` : "";
}

export function formatContactNpub(npub: string | null | undefined): string {
  const value = (npub || "").trim();
  if (!value) return "";
  const normalized = normalizeNostrPubkey(value);
  if (normalized) {
    try {
      return nip19.npubEncode(normalized.slice(-64));
    } catch {
      // fall through to raw value
    }
  }
  return value.startsWith("npub") ? value : value;
}

function normalizeUsername(value: unknown): string | undefined {
  const sanitized = sanitizeUsername(normalizeString(value));
  return sanitized ? sanitized : undefined;
}

function normalizeStringOrNull(value: unknown): string | undefined {
  const normalized = normalizeString(value).trim();
  return normalized ? normalized : undefined;
}

function normalizeRelayList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const relays = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
  return relays.length ? Array.from(new Set(relays)) : undefined;
}

export function makeContactId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function resolveContactKind(rawKind: unknown, npub: string, paymentRequest: string): ContactKind {
  if (rawKind === "nostr" || rawKind === "custom") return rawKind;
  if (npub.trim()) return "nostr";
  if (paymentRequest.trim()) return "custom";
  return "custom";
}

export function normalizeContact(raw: any): Contact | null {
  if (!raw || typeof raw !== "object") return null;
  const name = normalizeString(raw.name || raw.label);
  const address = normalizeString(raw.address || raw.lud16 || raw.lightningAddress);
  const paymentRequest = normalizeString(raw.paymentRequest || raw.creq || raw.cashuPaymentRequest);
  const npub = normalizeString(raw.npub || raw.pubkey);
  const username = normalizeUsername(raw.username);
  const displayName = normalizeStringOrNull(raw.displayName || raw.display_name);
  const nip05 = normalizeStringOrNull(raw.nip05);
  const about = normalizeStringOrNull(raw.about);
  const picture = normalizeStringOrNull(raw.picture);
  const relays = normalizeRelayList(raw.relays);
  const hasData = name.trim() || address.trim() || paymentRequest.trim() || npub.trim();
  if (!hasData) return null;
  const id = typeof raw.id === "string" && raw.id ? raw.id : makeContactId();
  const kind = resolveContactKind(raw.kind, npub, paymentRequest);
  const createdAt =
    typeof raw.createdAt === "number" && Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now();
  const updatedAt =
    typeof raw.updatedAt === "number" && Number.isFinite(raw.updatedAt) ? raw.updatedAt : createdAt;
  const source = typeof raw.source === "string" ? (raw.source as Contact["source"]) : undefined;
  return {
    id,
    kind,
    name,
    address,
    paymentRequest,
    npub,
    username: username ?? undefined,
    displayName: displayName ?? undefined,
    nip05: nip05 ?? undefined,
    about: about ?? undefined,
    picture: picture ?? undefined,
    relays,
    createdAt,
    updatedAt,
    source,
  };
}

export function normalizeContactSyncEntry(raw: any): ContactSyncEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const id = typeof raw.id === "string" && raw.id ? raw.id : makeContactId();
  const npub = normalizeStringOrNull(raw.npub);
  const name = normalizeStringOrNull(raw.name);
  const username = normalizeUsername(raw.username);
  const displayName = normalizeStringOrNull(raw.displayName || raw.display_name);
  const lud16 = normalizeStringOrNull(raw.lud16 || raw.address || raw.lightningAddress);
  const paymentRequest = normalizeStringOrNull(raw.paymentRequest || raw.creq);
  const nip05 = normalizeStringOrNull(raw.nip05);
  const about = normalizeStringOrNull(raw.about);
  const picture = normalizeStringOrNull(raw.picture);
  const relays = normalizeRelayList(raw.relays);
  const kind: ContactKind = raw.kind === "nostr" || raw.kind === "custom" ? raw.kind : npub ? "nostr" : "custom";
  if (!npub && !lud16 && !paymentRequest && !name && !username && !displayName) {
    return null;
  }
  return {
    id,
    kind,
    npub: npub ?? undefined,
    relays,
    name: name ?? undefined,
    username: username ?? undefined,
    displayName: displayName ?? undefined,
    lud16: lud16 ?? undefined,
    nip05: nip05 ?? undefined,
    paymentRequest: paymentRequest ?? undefined,
    creq: paymentRequest ?? undefined,
    about: about ?? undefined,
    picture: picture ?? undefined,
  };
}

export function loadContactsFromStorage(): Contact[] {
  try {
    const saved = idbKeyValue.getItem(TASKIFY_STORE_NOSTR, LS_LIGHTNING_CONTACTS);
    if (!saved) return [];
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((entry) => normalizeContact(entry)).filter(Boolean) as Contact[];
  } catch {
    return [];
  }
}

export function saveContactsToStorage(contacts: Contact[]): void {
  try {
    idbKeyValue.setItem(TASKIFY_STORE_NOSTR, LS_LIGHTNING_CONTACTS, JSON.stringify(contacts));
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("taskify:contacts-updated"));
    }
  } catch (error) {
    console.warn("Unable to save contacts", error);
  }
}

export function contactPrimaryName(contact: Contact): string {
  const nickname = contact.name?.trim();
  const displayName = contact.displayName?.trim();
  const username = formatContactUsername(contact.username);
  const npub = formatContactNpub(contact.npub);
  return nickname || displayName || username || npub || "Contact";
}

export function contactDisplayLabel(contact: Contact): string {
  return contactPrimaryName(contact);
}

export function contactHasNpub(contact: Contact): boolean {
  return contact.npub.trim().length > 0;
}

export function contactHasLightning(contact: Contact): boolean {
  return contact.address.trim().length > 0;
}

export function contactHasPaymentRequest(contact: Contact): boolean {
  return contact.paymentRequest.trim().length > 0;
}

export function buildContactSyncEnvelope(
  contacts: Contact[],
  updatedAt: number = Date.now(),
): ContactSyncEnvelope {
  const entries: ContactSyncEntry[] = contacts.map((contact) => ({
    id: contact.id,
    kind: contact.kind,
    npub: normalizeStringOrNull(contact.npub),
    relays: normalizeRelayList(contact.relays),
    name: normalizeStringOrNull(contact.name),
    username: normalizeUsername(contact.username),
    displayName: normalizeStringOrNull(contact.displayName),
    lud16: normalizeStringOrNull(contact.address),
    nip05: normalizeStringOrNull(contact.nip05),
    paymentRequest: normalizeStringOrNull(contact.paymentRequest),
    creq: normalizeStringOrNull(contact.paymentRequest),
    about: normalizeStringOrNull(contact.about),
    picture: normalizeStringOrNull(contact.picture),
  }));
  return {
    version: 1,
    updatedAt,
    contacts: entries,
  };
}

export function parseContactSyncEnvelope(raw: any): ContactSyncEnvelope | null {
  if (!raw || typeof raw !== "object") return null;
  const version = Number(raw.version) || 0;
  if (version !== 1) return null;
  const updatedAt = Number(raw.updatedAt) || Date.now();
  const entriesRaw = Array.isArray(raw.contacts) ? raw.contacts : [];
  const contacts = entriesRaw.map((entry: unknown) => normalizeContactSyncEntry(entry)).filter(Boolean) as ContactSyncEntry[];
  return { version: 1, updatedAt, contacts };
}

export function mergeContactsFromSync(existing: Contact[], envelope: ContactSyncEnvelope): Contact[] {
  const next = [...existing];
  const byKey = new Map<string, number>();
  existing.forEach((contact, index) => {
    const key = contact.npub.trim().toLowerCase() || `id:${contact.id}`;
    if (key) byKey.set(key, index);
  });
  envelope.contacts.forEach((entry) => {
    const npubKey = (entry.npub || "").trim().toLowerCase();
    const key = npubKey || `id:${entry.id}`;
    const existingIndex = byKey.get(key);
    const normalized = normalizeContact({
      ...entry,
      id: entry.id,
      address: entry.lud16,
      paymentRequest: entry.paymentRequest || entry.creq,
      relays: entry.relays,
      createdAt: envelope.updatedAt,
      updatedAt: envelope.updatedAt,
      source: "sync",
    });
    if (!normalized) return;
    if (existingIndex != null) {
      const prev = next[existingIndex];
      next[existingIndex] = {
        ...prev,
        ...normalized,
        id: prev.id, // preserve local id for stability
        name: normalized.name || prev.name,
        displayName: normalized.displayName || prev.displayName,
        username: normalized.username || prev.username,
        address: normalized.address || prev.address,
        paymentRequest: normalized.paymentRequest || prev.paymentRequest,
        nip05: normalized.nip05 || prev.nip05,
        about: normalized.about || prev.about,
        picture: normalized.picture || prev.picture,
        relays: normalized.relays?.length ? normalized.relays : prev.relays,
        updatedAt: Math.max(prev.updatedAt ?? 0, envelope.updatedAt),
      };
    } else {
      next.push(normalized);
    }
  });
  return next;
}
