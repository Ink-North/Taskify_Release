// Contact helper functions extracted from App.tsx

import type { Contact } from "../../lib/contacts";
import { normalizeNostrPubkey } from "../../lib/nostr";
import { idbKeyValue } from "../../storage/idbKeyValue";
import { TASKIFY_STORE_NOSTR } from "../../storage/taskifyDb";
import { LS_CONTACT_NIP05_CACHE } from "../../localStorageKeys";

// ---- NIP-05 check state ----

export type Nip05CheckState = {
  status: "pending" | "valid" | "invalid";
  nip05: string;
  npub: string;
  checkedAt: number;
  contactUpdatedAt?: number | null;
};

// ---- NIP-05 helpers ----

export function normalizeNip05(value?: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const atIndex = trimmed.indexOf("@");
  if (atIndex <= 0 || atIndex === trimmed.length - 1) return null;
  const name = trimmed.slice(0, atIndex).trim().toLowerCase();
  const domain = trimmed.slice(atIndex + 1).trim().toLowerCase();
  if (!name || !domain) return null;
  return `${name}@${domain}`;
}

export function compressedToRawHex(value: string): string {
  if (typeof value !== "string") return value;
  if (/^(02|03)[0-9a-fA-F]{64}$/.test(value)) return value.slice(-64);
  if (/^0x[0-9a-fA-F]{64}$/.test(value)) return value.slice(-64);
  if (/^[0-9a-fA-F]{64}$/.test(value)) return value.toLowerCase();
  return value;
}

export function normalizeNostrPubkeyHex(value: string | null | undefined): string | null {
  const trimmed = (value || "").trim();
  if (!trimmed) return null;
  const normalized = normalizeNostrPubkey(trimmed);
  const raw = compressedToRawHex(normalized ?? trimmed).toLowerCase();
  return /^[0-9a-f]{64}$/.test(raw) ? raw : null;
}

export function loadNip05Cache(): Record<string, Nip05CheckState> {
  try {
    const raw = idbKeyValue.getItem(TASKIFY_STORE_NOSTR, LS_CONTACT_NIP05_CACHE);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const entries: Record<string, Nip05CheckState> = {};
    Object.entries(parsed as Record<string, any>).forEach(([key, value]) => {
      if (!value || typeof value !== "object") return;
      const status = (value as any).status;
      const nip05 = typeof (value as any).nip05 === "string" ? (value as any).nip05 : "";
      const npub = typeof (value as any).npub === "string" ? (value as any).npub : "";
      const checkedAt = Number((value as any).checkedAt) || 0;
      const contactUpdatedAtRaw = Number((value as any).contactUpdatedAt);
      if (!nip05 || !npub) return;
      if (status !== "pending" && status !== "valid" && status !== "invalid") return;
      entries[key] = {
        status,
        nip05,
        npub,
        checkedAt: checkedAt || Date.now(),
        contactUpdatedAt: Number.isFinite(contactUpdatedAtRaw) ? contactUpdatedAtRaw : null,
      };
    });
    return entries;
  } catch {
    return {};
  }
}

export function contactVerifiedNip05(contact: Contact, cache: Record<string, Nip05CheckState>): string | null {
  if (!contact?.id) return null;
  const nip05 = contact.nip05?.trim();
  const npub = contact.npub?.trim();
  if (!nip05 || !npub) return null;
  const normalizedNip05 = normalizeNip05(nip05);
  const normalizedNpub = normalizeNostrPubkey(npub);
  if (!normalizedNip05 || !normalizedNpub) return null;
  const entry = cache[contact.id];
  if (!entry || entry.status !== "valid") return null;
  const cachedNip05 = normalizeNip05(entry.nip05);
  const cachedHex = (entry.npub || "").toLowerCase();
  const contactHex = compressedToRawHex(normalizedNpub).toLowerCase();
  if (!cachedNip05 || cachedNip05 !== normalizedNip05) return null;
  if (!cachedHex || cachedHex !== contactHex) return null;
  return nip05 || entry.nip05;
}

export function contactInitials(value: string): string {
  const trimmed = (value || "").trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
