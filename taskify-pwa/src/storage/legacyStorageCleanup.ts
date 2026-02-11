import {
  LS_CONTACTS_SYNC_META,
  LS_CONTACT_NIP05_CACHE,
  LS_CONTACT_PROFILE_CACHE,
  LS_NIP51_CONTACTS_MIGRATED,
  LS_DM_BLOCKED_PEERS,
  LS_DM_DELETED_EVENTS,
  LS_ECASH_OPEN_REQUESTS,
  LS_LIGHTNING_CONTACTS,
  LS_MINT_BACKUP_CACHE,
  LS_PROFILE_EVENT_IDS,
  LS_PROFILE_METADATA_CACHE,
  LS_RELAY_INFO_CACHE,
  LS_SPENT_NOSTR_PAYMENTS,
} from "../localStorageKeys";
import { kvStorage } from "./kvStorage";

/**
 * `legacyStorageCleanup`
 * ---------------------
 * Post-migration helper for deleting *only* the legacy `localStorage` keys that
 * have been migrated into IndexedDB.
 *
 * Storage boundaries:
 * - `kvStorage` is the only production module allowed to read/write `localStorage`.
 * - Domain persistence lives in IndexedDB via `idbKeyValue` / `idbStorage`.
 * - This cleanup preserves `kvStorage` entries (feature flags, keys, settings).
 *
 * IMPORTANT:
 * - This function must be user-triggered only (never call it automatically).
 * - Only add keys here once Taskify reads/writes them from IndexedDB.
 */

const TASKS_KEY = "taskify_tasks_v5";
const TASKS_LEGACY_KEYS = ["taskify_tasks_v4"] as const;
const BOARDS_KEY = "taskify_boards_v2";

const CASHU_PROOFS_KEY = "cashu_proofs_v1";
const CASHU_ACTIVE_MINT_KEY = "cashu_active_mint_v1";
const CASHU_PENDING_TOKENS_KEY = "cashu_pending_tokens_v1";
const CASHU_MINT_LIST_KEY = "cashu_tracked_mints_v1";
const CASHU_HISTORY_KEY = "cashuHistory";
const CASHU_NIP60_STATE_KEY = "cashu_nip60_state_v1";
const CASHU_NIP60_QUEUE_KEY = "cashu_nip60_queue_v1";
const CASHU_NIP61_PROCESSED_KEY = "cashu_nip61_processed_v1";
const CASHU_NIP61_SINCE_KEY = "cashu_nip61_since_v1";

const PROFILE_SHARE_CACHE_KEY = "taskify.profileSharePayload.v1";
const INBOX_PROCESSED_KEY = "taskify_inbox_processed_v1";

const MIGRATED_LEGACY_LOCALSTORAGE_KEYS: readonly string[] = [
  // Tasks store
  TASKS_KEY,
  ...TASKS_LEGACY_KEYS,
  BOARDS_KEY,

  // Wallet store
  CASHU_PROOFS_KEY,
  CASHU_ACTIVE_MINT_KEY,
  CASHU_PENDING_TOKENS_KEY,
  CASHU_MINT_LIST_KEY,
  CASHU_HISTORY_KEY,
  CASHU_NIP60_STATE_KEY,
  CASHU_NIP60_QUEUE_KEY,
  CASHU_NIP61_PROCESSED_KEY,
  CASHU_NIP61_SINCE_KEY,
  LS_MINT_BACKUP_CACHE,
  LS_ECASH_OPEN_REQUESTS,
  LS_SPENT_NOSTR_PAYMENTS,

  // Nostr store
  LS_LIGHTNING_CONTACTS,
  LS_CONTACTS_SYNC_META,
  LS_NIP51_CONTACTS_MIGRATED,
  LS_CONTACT_NIP05_CACHE,
  LS_RELAY_INFO_CACHE,
  LS_PROFILE_METADATA_CACHE,
  LS_CONTACT_PROFILE_CACHE,
  LS_PROFILE_EVENT_IDS,
  LS_DM_DELETED_EVENTS,
  LS_DM_BLOCKED_PEERS,
  PROFILE_SHARE_CACHE_KEY,
  INBOX_PROCESSED_KEY,
];

export function hasMigratedLegacyLocalStorageKeys(): boolean {
  for (const key of MIGRATED_LEGACY_LOCALSTORAGE_KEYS) {
    if (kvStorage.getItem(key) !== null) return true;
  }
  return false;
}

export function cleanupMigratedLegacyLocalStorageKeys(): void {
  for (const key of MIGRATED_LEGACY_LOCALSTORAGE_KEYS) {
    kvStorage.removeItem(key);
  }
}
