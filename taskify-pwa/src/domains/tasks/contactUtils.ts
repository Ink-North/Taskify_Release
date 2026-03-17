// Contact helper functions extracted from App.tsx

import type { Contact } from "../../lib/contacts";
import {
  normalizeNip05,
  compressedToRawHex,
  normalizeNostrPubkeyHex,
  contactVerifiedNip05 as contactVerifiedNip05Core,
  contactInitials,
  type Nip05CheckState,
} from "taskify-core";
import { normalizeNostrPubkey } from "../../lib/nostr";
import { idbKeyValue } from "../../storage/idbKeyValue";
import { TASKIFY_STORE_NOSTR } from "../../storage/taskifyDb";
import { LS_CONTACT_NIP05_CACHE } from "../../localStorageKeys";

export {
  normalizeNip05,
  compressedToRawHex,
  normalizeNostrPubkeyHex,
  contactInitials,
};
export type { Nip05CheckState };

// ---- NIP-05 check state + pure helpers now sourced from taskify-core ----

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
  const normalizedNpub = normalizeNostrPubkey(contact.npub || "");
  return contactVerifiedNip05Core({
    id: contact.id,
    nip05: contact.nip05,
    npub: normalizedNpub || contact.npub,
  }, cache);
}
