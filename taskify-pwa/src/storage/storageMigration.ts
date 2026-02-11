import {
  LS_BTC_USD_PRICE_CACHE,
  LS_CONTACTS_SYNC_META,
  LS_CONTACT_NIP05_CACHE,
  LS_CONTACT_PROFILE_CACHE,
  LS_NIP51_CONTACTS_MIGRATED,
  LS_DM_BLOCKED_PEERS,
  LS_DM_DELETED_EVENTS,
  LS_ECASH_OPEN_REQUESTS,
  LS_LIGHTNING_CONTACTS,
  LS_MINT_BACKUP_CACHE,
  LS_MINT_BACKUP_ENABLED,
  LS_P2PK_KEYS,
  LS_PROFILE_EVENT_IDS,
  LS_PROFILE_METADATA_CACHE,
  LS_RELAY_INFO_CACHE,
  LS_SPENT_NOSTR_PAYMENTS,
  LS_URL_PREVIEW_CACHE,
} from "../localStorageKeys";
import { LS_NOSTR_BACKUP_STATE, LS_NOSTR_RELAYS, LS_NOSTR_SK } from "../nostrKeys";
import { idbStorage } from "./idbStorage";
import { legacyStorage } from "./legacyStorage";
import { getTaskifyDb, TASKIFY_STORE_NOSTR, TASKIFY_STORE_TASKS, TASKIFY_STORE_WALLET } from "./taskifyDb";

export type StorageMigrationState = "migration_not_started" | "migration_in_progress" | "migration_complete";

export type StorageMigrationPhase = "wallet" | "nostr" | "tasks" | "settings";

export type StorageMigrationProgress = {
  state: StorageMigrationState;
  phase: StorageMigrationPhase | null;
  completedPhases: number;
  totalPhases: number;
  startedAt: number | null;
  updatedAt: number;
  completedAt: number | null;
  currentKey?: { storeName: string; key: string };
  error?: string;
};

type MigrationRecordV1 = {
  version: 1;
  state: StorageMigrationState;
  completedPhases: StorageMigrationPhase[];
  startedAt: number | null;
  updatedAt: number;
  completedAt: number | null;
};

const MIGRATION_RECORD_KEY = "taskify.storageMigration.v1";

const PHASE_ORDER: readonly StorageMigrationPhase[] = ["wallet", "nostr", "tasks", "settings"] as const;

const PROFILE_SHARE_CACHE_KEY = "taskify.profileSharePayload.v1";

const TASKS_KEY = "taskify_tasks_v5";
const TASKS_LEGACY_KEYS = ["taskify_tasks_v4"] as const;
const BOARDS_KEY = "taskify_boards_v2";

const USER_SETTINGS_KEY = "taskify_settings_v2";
const TUTORIAL_DONE_KEY = "taskify_tutorial_done_v1";
const BIBLE_TRACKER_KEY = "taskify_bible_tracker_v1";
const SCRIPTURE_MEMORY_KEY = "taskify_scripture_memory_v1";
const MESSAGES_BOARD_ID_KEY = "taskify_messages_board_id_v1";
const LAST_CLOUD_BACKUP_KEY = "taskify_cloud_backup_last_v1";
const LAST_MANUAL_CLOUD_BACKUP_KEY = "taskify_cloud_backup_manual_last_v1";
const DEBUG_CONSOLE_STORAGE_KEY = "taskify.debugConsole.enabled";

const NWC_URI_KEY = "cashu_nwc_connection_v1";
const WALLET_SEED_KEY = "cashu_wallet_seed_v1";
const WALLET_COUNTERS_KEY = "cashu_wallet_seed_counters_v1";

const CASHU_PROOFS_KEY = "cashu_proofs_v1";
const CASHU_ACTIVE_MINT_KEY = "cashu_active_mint_v1";
const CASHU_PENDING_TOKENS_KEY = "cashu_pending_tokens_v1";
const CASHU_MINT_LIST_KEY = "cashu_tracked_mints_v1";
const CASHU_HISTORY_KEY = "cashuHistory";
const CASHU_NIP60_STATE_KEY = "cashu_nip60_state_v1";
const CASHU_NIP60_QUEUE_KEY = "cashu_nip60_queue_v1";
const CASHU_NIP61_PROCESSED_KEY = "cashu_nip61_processed_v1";
const CASHU_NIP61_SINCE_KEY = "cashu_nip61_since_v1";

type MigrationSubscriber = (progress: StorageMigrationProgress) => void;

const subscribers = new Set<MigrationSubscriber>();

let lastProgress: StorageMigrationProgress = {
  state: "migration_not_started",
  phase: null,
  completedPhases: 0,
  totalPhases: PHASE_ORDER.length,
  startedAt: null,
  updatedAt: Date.now(),
  completedAt: null,
};

let activeRun: Promise<void> | null = null;

function safeNow(): number {
  return Date.now();
}

function normalizeCompletedPhases(raw: unknown): StorageMigrationPhase[] {
  if (!Array.isArray(raw)) return [];
  const normalized = raw.filter((phase): phase is StorageMigrationPhase =>
    phase === "wallet" || phase === "nostr" || phase === "tasks" || phase === "settings",
  );

  const result: StorageMigrationPhase[] = [];
  for (const phase of PHASE_ORDER) {
    if (normalized[result.length] === phase) {
      result.push(phase);
      continue;
    }
    break;
  }
  return result;
}

function normalizeRecord(raw: unknown): MigrationRecordV1 | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Partial<MigrationRecordV1>;
  if (record.version !== 1) return null;
  if (
    record.state !== "migration_not_started" &&
    record.state !== "migration_in_progress" &&
    record.state !== "migration_complete"
  ) {
    return null;
  }

  const startedAt = typeof record.startedAt === "number" && Number.isFinite(record.startedAt) ? record.startedAt : null;
  const completedAt =
    typeof record.completedAt === "number" && Number.isFinite(record.completedAt) ? record.completedAt : null;
  const updatedAt = typeof record.updatedAt === "number" && Number.isFinite(record.updatedAt) ? record.updatedAt : 0;

  return {
    version: 1,
    state: record.state,
    completedPhases: normalizeCompletedPhases(record.completedPhases),
    startedAt,
    updatedAt: updatedAt > 0 ? updatedAt : safeNow(),
    completedAt,
  };
}

function recordToProgress(record: MigrationRecordV1, options?: { currentKey?: { storeName: string; key: string } }): StorageMigrationProgress {
  const completedPhases = record.state === "migration_complete" ? PHASE_ORDER.length : record.completedPhases.length;
  const phase = record.state === "migration_in_progress" ? PHASE_ORDER[completedPhases] ?? null : null;
  return {
    state: record.state,
    phase,
    completedPhases,
    totalPhases: PHASE_ORDER.length,
    startedAt: record.startedAt,
    updatedAt: record.updatedAt,
    completedAt: record.completedAt,
    currentKey: options?.currentKey,
  };
}

function emitProgress(progress: StorageMigrationProgress): void {
  lastProgress = progress;
  for (const cb of subscribers) {
    try {
      cb(progress);
    } catch {
      // ignore subscriber errors
    }
  }
}

function errorToString(error: unknown): string {
  if (error instanceof Error) return error.message || "Migration failed";
  if (typeof error === "string" && error.trim()) return error;
  return "Migration failed";
}

async function loadRecord(db: IDBDatabase): Promise<MigrationRecordV1 | null> {
  const raw = await idbStorage.get<unknown>(db, TASKIFY_STORE_WALLET, MIGRATION_RECORD_KEY);
  return normalizeRecord(raw);
}

async function persistRecord(db: IDBDatabase, record: MigrationRecordV1): Promise<void> {
  await idbStorage.put(db, TASKIFY_STORE_WALLET, record, MIGRATION_RECORD_KEY);
}

function defaultNotStartedRecord(): MigrationRecordV1 {
  const now = safeNow();
  return {
    version: 1,
    state: "migration_not_started",
    completedPhases: [],
    startedAt: null,
    updatedAt: now,
    completedAt: null,
  };
}

async function copyLegacyKeyToIdb(
  db: IDBDatabase,
  storeName: string,
  key: string,
): Promise<"missing" | "skipped" | "copied"> {
  const raw = legacyStorage.getItem(key);
  if (raw === null) return "missing";

  const existing = await idbStorage.get<unknown>(db, storeName, key);
  if (existing !== undefined) return "skipped";

  await idbStorage.put<string>(db, storeName, raw, key);
  return "copied";
}

async function migrateWallet(db: IDBDatabase): Promise<void> {
  const walletKeys: string[] = [
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
    LS_MINT_BACKUP_ENABLED,
    LS_P2PK_KEYS,
    NWC_URI_KEY,
    WALLET_SEED_KEY,
    WALLET_COUNTERS_KEY,
    LS_BTC_USD_PRICE_CACHE,
  ];

  for (const key of walletKeys) {
    emitProgress({ ...lastProgress, currentKey: { storeName: TASKIFY_STORE_WALLET, key }, updatedAt: safeNow() });
    await copyLegacyKeyToIdb(db, TASKIFY_STORE_WALLET, key);
  }
}

async function migrateNostr(db: IDBDatabase): Promise<void> {
  const nostrKeys: string[] = [
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
    "taskify_inbox_processed_v1",
  ];

  for (const key of nostrKeys) {
    emitProgress({ ...lastProgress, currentKey: { storeName: TASKIFY_STORE_NOSTR, key }, updatedAt: safeNow() });
    await copyLegacyKeyToIdb(db, TASKIFY_STORE_NOSTR, key);
  }
}

async function migrateTasks(db: IDBDatabase): Promise<void> {
  emitProgress({ ...lastProgress, currentKey: { storeName: TASKIFY_STORE_TASKS, key: BOARDS_KEY }, updatedAt: safeNow() });
  await copyLegacyKeyToIdb(db, TASKIFY_STORE_TASKS, BOARDS_KEY);

  const existingV5 = await idbStorage.get<unknown>(db, TASKIFY_STORE_TASKS, TASKS_KEY);
  if (existingV5 !== undefined) {
    return;
  }

  const existingLegacy = await Promise.all(
    TASKS_LEGACY_KEYS.map(async (legacyKey) => await idbStorage.get<unknown>(db, TASKIFY_STORE_TASKS, legacyKey)),
  );
  if (existingLegacy.some((value) => value !== undefined)) {
    return;
  }

  const current = legacyStorage.getItem(TASKS_KEY);
  if (current !== null) {
    emitProgress({ ...lastProgress, currentKey: { storeName: TASKIFY_STORE_TASKS, key: TASKS_KEY }, updatedAt: safeNow() });
    await idbStorage.put<string>(db, TASKIFY_STORE_TASKS, current, TASKS_KEY);
    return;
  }

  for (const legacyKey of TASKS_LEGACY_KEYS) {
    const legacyValue = legacyStorage.getItem(legacyKey);
    if (legacyValue === null) continue;
    emitProgress({ ...lastProgress, currentKey: { storeName: TASKIFY_STORE_TASKS, key: legacyKey }, updatedAt: safeNow() });
    await idbStorage.put<string>(db, TASKIFY_STORE_TASKS, legacyValue, TASKS_KEY);
    return;
  }
}

async function migrateSettings(db: IDBDatabase): Promise<void> {
  const taskSettingsKeys: string[] = [
    USER_SETTINGS_KEY,
    TUTORIAL_DONE_KEY,
    BIBLE_TRACKER_KEY,
    SCRIPTURE_MEMORY_KEY,
    MESSAGES_BOARD_ID_KEY,
    LAST_CLOUD_BACKUP_KEY,
    LAST_MANUAL_CLOUD_BACKUP_KEY,
    DEBUG_CONSOLE_STORAGE_KEY,
    LS_URL_PREVIEW_CACHE,
  ];

  for (const key of taskSettingsKeys) {
    emitProgress({ ...lastProgress, currentKey: { storeName: TASKIFY_STORE_TASKS, key }, updatedAt: safeNow() });
    await copyLegacyKeyToIdb(db, TASKIFY_STORE_TASKS, key);
  }

  const nostrSettingsKeys: string[] = [LS_NOSTR_RELAYS, LS_NOSTR_SK, LS_NOSTR_BACKUP_STATE];
  for (const key of nostrSettingsKeys) {
    emitProgress({ ...lastProgress, currentKey: { storeName: TASKIFY_STORE_NOSTR, key }, updatedAt: safeNow() });
    await copyLegacyKeyToIdb(db, TASKIFY_STORE_NOSTR, key);
  }
}

async function runMigrationInternal(mode: "start" | "resume"): Promise<void> {
  const db = await getTaskifyDb();

  const stored = await loadRecord(db);
  if (mode === "resume") {
    if (!stored) {
      const record = defaultNotStartedRecord();
      await persistRecord(db, record);
      emitProgress(recordToProgress(record));
      return;
    }
    emitProgress(recordToProgress(stored));
    if (stored.state !== "migration_in_progress") return;
  }

  let record: MigrationRecordV1;
  if (stored) {
    record = stored;
  } else {
    record = defaultNotStartedRecord();
  }

  if (mode === "start") {
    if (record.state === "migration_complete") {
      emitProgress(recordToProgress(record));
      return;
    }
    if (record.state !== "migration_in_progress") {
      const now = safeNow();
      record = {
        version: 1,
        state: "migration_in_progress",
        completedPhases: [],
        startedAt: now,
        updatedAt: now,
        completedAt: null,
      };
      await persistRecord(db, record);
      emitProgress(recordToProgress(record));
    }
  }

  if (record.state !== "migration_in_progress") {
    emitProgress(recordToProgress(record));
    return;
  }

  const completed = normalizeCompletedPhases(record.completedPhases);
  for (let index = completed.length; index < PHASE_ORDER.length; index += 1) {
    const phase = PHASE_ORDER[index];
    const now = safeNow();
    emitProgress({
      ...recordToProgress({ ...record, completedPhases: completed, updatedAt: now }),
      phase,
      updatedAt: now,
    });

    if (phase === "wallet") await migrateWallet(db);
    else if (phase === "nostr") await migrateNostr(db);
    else if (phase === "tasks") await migrateTasks(db);
    else if (phase === "settings") await migrateSettings(db);

    completed.push(phase);
    record = { ...record, completedPhases: [...completed], updatedAt: safeNow() };
    await persistRecord(db, record);
    emitProgress(recordToProgress(record));
  }

  const finishedAt = safeNow();
  record = {
    ...record,
    state: "migration_complete",
    completedPhases: [...PHASE_ORDER],
    completedAt: finishedAt,
    updatedAt: finishedAt,
  };
  await persistRecord(db, record);
  emitProgress(recordToProgress(record));
}

function runWithLock(mode: "start" | "resume"): Promise<void> {
  if (activeRun) return activeRun;
  activeRun = runMigrationInternal(mode)
    .catch((error) => {
      emitProgress({ ...lastProgress, error: errorToString(error), updatedAt: safeNow() });
      throw error;
    })
    .finally(() => {
      activeRun = null;
    });
  return activeRun;
}

export async function startMigration(): Promise<void> {
  await runWithLock("start");
}

export async function resumeMigrationIfNeeded(): Promise<void> {
  await runWithLock("resume");
}

export function subscribeMigrationProgress(cb: (progress: StorageMigrationProgress) => void): () => void {
  subscribers.add(cb);
  try {
    cb(lastProgress);
  } catch {
    // ignore subscriber errors
  }
  return () => {
    subscribers.delete(cb);
  };
}
