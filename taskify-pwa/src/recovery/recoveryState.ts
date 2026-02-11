import { kvStorage } from "../storage/kvStorage";
import {
  MIGRATION_COMPLETED_AT_KEY,
  MIGRATION_DEFERRED_KEY,
  MIGRATION_STATE_KEY,
  STORAGE_MIGRATION_MARKER_KEY,
} from "../storage/storageWriteLock";
import {
  BOOT_ATTEMPTS_KEY,
  FORCE_LEGACY_MODE_KEY,
  FORCE_RECOVERY_PROMPT_KEY,
  LAST_BOOT_OK_TS_KEY,
  LAST_BOOT_TS_KEY,
} from "../storage/recoveryKeys";

const CRASH_WINDOW_MS = 2 * 60 * 1000;

export type BootAttemptResult = {
  attempts: number;
  crashLoopDetected: boolean;
};

export function recordBootAttempt(now = Date.now()): BootAttemptResult {
  try {
    const lastBootTs = kvStorage.getNumber(LAST_BOOT_TS_KEY, 0);
    let attempts = kvStorage.getNumber(BOOT_ATTEMPTS_KEY, 0);
    const withinWindow = lastBootTs > 0 && now - lastBootTs <= CRASH_WINDOW_MS;
    if (!withinWindow) attempts = 0;
    attempts += 1;
    kvStorage.setNumber(BOOT_ATTEMPTS_KEY, attempts);
    kvStorage.setNumber(LAST_BOOT_TS_KEY, now);
    return { attempts, crashLoopDetected: withinWindow && attempts >= 3 };
  } catch {
    return { attempts: 0, crashLoopDetected: false };
  }
}

export function markBootOk(now = Date.now()): void {
  try {
    kvStorage.setNumber(LAST_BOOT_OK_TS_KEY, now);
    kvStorage.setNumber(BOOT_ATTEMPTS_KEY, 0);
  } catch {
    // ignore persistence errors
  }
}

export function resetBootAttempts(): void {
  try {
    kvStorage.setNumber(BOOT_ATTEMPTS_KEY, 0);
  } catch {
    // ignore persistence errors
  }
}

export function isForceRecoveryPrompt(): boolean {
  try {
    return kvStorage.getBoolean(FORCE_RECOVERY_PROMPT_KEY, false);
  } catch {
    return false;
  }
}

export function setForceRecoveryPrompt(value: boolean): void {
  try {
    kvStorage.setBoolean(FORCE_RECOVERY_PROMPT_KEY, value);
  } catch {
    // ignore persistence errors
  }
}

export function isForceLegacyMode(): boolean {
  try {
    return kvStorage.getBoolean(FORCE_LEGACY_MODE_KEY, false);
  } catch {
    return false;
  }
}

export function setForceLegacyMode(value: boolean): void {
  try {
    kvStorage.setBoolean(FORCE_LEGACY_MODE_KEY, value);
  } catch {
    // ignore persistence errors
  }
}

export function resetMigrationMarkers(): void {
  try {
    kvStorage.setItem(MIGRATION_STATE_KEY, "not_started");
  } catch {}
  try {
    kvStorage.setBoolean(MIGRATION_DEFERRED_KEY, false);
  } catch {}
  try {
    kvStorage.removeItem(MIGRATION_COMPLETED_AT_KEY);
  } catch {}
  try {
    kvStorage.removeItem(STORAGE_MIGRATION_MARKER_KEY);
  } catch {}
}
