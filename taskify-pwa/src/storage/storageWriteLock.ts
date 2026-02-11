import {
  BOOT_ATTEMPTS_KEY,
  FORCE_LEGACY_MODE_KEY,
  FORCE_RECOVERY_PROMPT_KEY,
  LAST_BOOT_OK_TS_KEY,
  LAST_BOOT_TS_KEY,
} from "./recoveryKeys";

export type StorageMigrationMarkerState = "migration_not_started" | "migration_in_progress" | "migration_complete";

/**
 * `storageWriteLock`
 * -----------------
 * Global, in-memory toggle used to block local persistence while storage migration runs.
 *
 * Notes:
 * - The migration engine writes directly to `idbStorage` and is not affected by this lock.
 * - We still allow writes to migration marker/gate keys so the lock can be persisted/cleared.
 */
export const STORAGE_MIGRATION_MARKER_KEY = "taskify.storageMigration.state.v1";
export const MIGRATION_STATE_KEY = "migration_state";
export const MIGRATION_DEFERRED_KEY = "migration_deferred";
export const MIGRATION_COMPLETED_AT_KEY = "migration_completed_at";

let writesBlocked = false;

export function setStorageWritesBlocked(blocked: boolean): void {
  writesBlocked = blocked;
}

export function areStorageWritesBlocked(): boolean {
  return writesBlocked;
}

export function shouldBlockKvWrite(key: string): boolean {
  if (!writesBlocked) return false;
  if (
    key === STORAGE_MIGRATION_MARKER_KEY ||
    key === MIGRATION_STATE_KEY ||
    key === MIGRATION_DEFERRED_KEY ||
    key === MIGRATION_COMPLETED_AT_KEY ||
    key === FORCE_LEGACY_MODE_KEY ||
    key === FORCE_RECOVERY_PROMPT_KEY ||
    key === BOOT_ATTEMPTS_KEY ||
    key === LAST_BOOT_TS_KEY ||
    key === LAST_BOOT_OK_TS_KEY
  ) {
    return false;
  }
  return true;
}
