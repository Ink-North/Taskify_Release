import React, { useCallback, useEffect, useMemo, useState } from "react";
import { kvStorage } from "../storage/kvStorage";
import {
  MIGRATION_DEFERRED_KEY,
  MIGRATION_STATE_KEY,
} from "../storage/storageWriteLock";
import { MIGRATION_RECORD_KEY } from "../storage/migrationKeys";
import { idbStorage } from "../storage/idbStorage";
import {
  getTaskifyDb,
  TASKIFY_DB_NAME,
  TASKIFY_DB_VERSION,
  TASKIFY_STORE_NOSTR,
  TASKIFY_STORE_TASKS,
  TASKIFY_STORE_WALLET,
} from "../storage/taskifyDb";
import {
  BOOT_ATTEMPTS_KEY,
  FORCE_LEGACY_MODE_KEY,
  FORCE_RECOVERY_PROMPT_KEY,
  LAST_BOOT_OK_TS_KEY,
  LAST_BOOT_TS_KEY,
} from "../storage/recoveryKeys";
import { buildExitRecoveryUrl } from "./recoveryRouting";
import { resetBootAttempts, resetMigrationMarkers, setForceLegacyMode, setForceRecoveryPrompt } from "./recoveryState";

type IdbStatus = "checking" | "ok" | "failed" | "unavailable";

const IDB_DELETE_CHECK_DB = "taskify-recovery-delete-check";

function normalizeMigrationState(raw: string | null): string | null {
  if (raw === "not_started" || raw === "in_progress" || raw === "completed") return raw;
  return raw ? "unknown" : null;
}

function statusToDisplay(status: IdbStatus): string {
  if (status === "ok") return "ok";
  if (status === "failed") return "failed";
  if (status === "unavailable") return "unavailable";
  return "checking";
}

function statusToJson(status: IdbStatus): boolean | null {
  if (status === "ok") return true;
  if (status === "failed") return false;
  return null;
}

function getAppVersion(): string | null {
  const env = (import.meta as any)?.env ?? {};
  const version =
    (typeof env.VITE_APP_VERSION === "string" && env.VITE_APP_VERSION.trim()) ||
    (typeof env.VITE_COMMIT_SHA === "string" && env.VITE_COMMIT_SHA.trim()) ||
    (typeof env.VITE_COMMIT_HASH === "string" && env.VITE_COMMIT_HASH.trim()) ||
    "";
  return version ? String(version) : null;
}

async function clearMigrationRecord(): Promise<void> {
  try {
    const db = await getTaskifyDb();
    await idbStorage.delete(db, TASKIFY_STORE_WALLET, MIGRATION_RECORD_KEY);
    try {
      db.close();
    } catch {
      // ignore close errors
    }
  } catch {
    // ignore storage errors
  }
}

async function deleteTaskifyDb(): Promise<boolean> {
  if (typeof indexedDB === "undefined") return false;
  return await new Promise<boolean>((resolve) => {
    try {
      const request = indexedDB.deleteDatabase(TASKIFY_DB_NAME);
      request.onsuccess = () => resolve(true);
      request.onerror = () => resolve(false);
      request.onblocked = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

async function checkIdbOpen(): Promise<IdbStatus> {
  if (typeof indexedDB === "undefined") return "unavailable";
  try {
    const db = await idbStorage.openDatabase({
      name: TASKIFY_DB_NAME,
      version: TASKIFY_DB_VERSION,
      upgrade(database) {
        if (!database.objectStoreNames.contains(TASKIFY_STORE_WALLET)) {
          database.createObjectStore(TASKIFY_STORE_WALLET);
        }
        if (!database.objectStoreNames.contains(TASKIFY_STORE_NOSTR)) {
          database.createObjectStore(TASKIFY_STORE_NOSTR);
        }
        if (!database.objectStoreNames.contains(TASKIFY_STORE_TASKS)) {
          database.createObjectStore(TASKIFY_STORE_TASKS);
        }
      },
    });
    try {
      db.close();
    } catch {
      // ignore close errors
    }
    return "ok";
  } catch {
    return "failed";
  }
}

async function checkIdbDelete(): Promise<IdbStatus> {
  if (typeof indexedDB === "undefined") return "unavailable";
  return await new Promise<IdbStatus>((resolve) => {
    try {
      const request = indexedDB.deleteDatabase(IDB_DELETE_CHECK_DB);
      request.onsuccess = () => resolve("ok");
      request.onerror = () => resolve("failed");
      request.onblocked = () => resolve("failed");
    } catch {
      resolve("failed");
    }
  });
}

export function RecoveryScreen() {
  const [actionBusy, setActionBusy] = useState<"legacy" | "reset" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");
  const [idbOpenStatus, setIdbOpenStatus] = useState<IdbStatus>("checking");
  const [idbDeleteStatus, setIdbDeleteStatus] = useState<IdbStatus>("checking");

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const [openStatus, deleteStatus] = await Promise.all([checkIdbOpen(), checkIdbDelete()]);
      if (!mounted) return;
      setIdbOpenStatus(openStatus);
      setIdbDeleteStatus(deleteStatus);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const diagnostics = useMemo(() => {
    const migrationState = normalizeMigrationState(kvStorage.getItem(MIGRATION_STATE_KEY));
    const migrationDeferred = kvStorage.getBoolean(MIGRATION_DEFERRED_KEY, false);
    const forceLegacyMode = kvStorage.getBoolean(FORCE_LEGACY_MODE_KEY, false);
    const forceRecoveryPrompt = kvStorage.getBoolean(FORCE_RECOVERY_PROMPT_KEY, false);
    const bootAttempts = kvStorage.getNumber(BOOT_ATTEMPTS_KEY, 0);
    const lastBootTs = kvStorage.getNumber(LAST_BOOT_TS_KEY, 0);
    const lastBootOkTs = kvStorage.getNumber(LAST_BOOT_OK_TS_KEY, 0);
    const appVersion = getAppVersion();

    return {
      migration_state: migrationState,
      migration_deferred: migrationDeferred,
      force_legacy_mode: forceLegacyMode,
      force_recovery_prompt: forceRecoveryPrompt,
      boot_attempts: bootAttempts,
      last_boot_ts: lastBootTs,
      last_boot_ok_ts: lastBootOkTs,
      indexeddb_open_ok: statusToJson(idbOpenStatus),
      indexeddb_delete_ok: statusToJson(idbDeleteStatus),
      app_version: appVersion,
    };
  }, [idbOpenStatus, idbDeleteStatus]);

  const handleStartLegacyMode = useCallback(async () => {
    if (actionBusy) return;
    setActionBusy("legacy");
    setActionError(null);
    try {
      setForceLegacyMode(true);
      resetBootAttempts();
      resetMigrationMarkers();
      await clearMigrationRecord();
      setForceRecoveryPrompt(false);
      const exitUrl = buildExitRecoveryUrl();
      window.location.assign(exitUrl || window.location.href);
    } catch {
      setActionError("Unable to start in legacy mode. Please try again.");
    } finally {
      setActionBusy(null);
    }
  }, [actionBusy]);

  const handleRetryNormalMode = useCallback(() => {
    if (actionBusy) return;
    setActionError(null);
    resetBootAttempts();
    setForceRecoveryPrompt(false);
    const exitUrl = buildExitRecoveryUrl();
    window.location.assign(exitUrl || window.location.href);
  }, [actionBusy]);

  const handleResetMigration = useCallback(async () => {
    if (actionBusy) return;
    setActionBusy("reset");
    setActionError(null);
    try {
      resetBootAttempts();
      resetMigrationMarkers();
      const deleted = await deleteTaskifyDb();
      if (!deleted) {
        setActionError("Unable to reset migration. Close other tabs and try again.");
        return;
      }
      setForceRecoveryPrompt(false);
      const exitUrl = buildExitRecoveryUrl();
      window.location.assign(exitUrl || window.location.href);
    } catch {
      setActionError("Unable to reset migration. Please try again.");
    } finally {
      setActionBusy(null);
    }
  }, [actionBusy]);

  const handleCopyDiagnostics = useCallback(async () => {
    setCopyStatus("idle");
    try {
      const payload: Record<string, unknown> = {
        timestamp: new Date().toISOString(),
        migration_state: diagnostics.migration_state,
        migration_deferred: diagnostics.migration_deferred,
        force_legacy_mode: diagnostics.force_legacy_mode,
        force_recovery_prompt: diagnostics.force_recovery_prompt,
        boot_attempts: diagnostics.boot_attempts,
        last_boot_ts: diagnostics.last_boot_ts,
        last_boot_ok_ts: diagnostics.last_boot_ok_ts,
        indexeddb_open_ok: diagnostics.indexeddb_open_ok,
        indexeddb_delete_ok: diagnostics.indexeddb_delete_ok,
      };
      if (typeof navigator !== "undefined") {
        payload.userAgent = navigator.userAgent;
      }
      if (diagnostics.app_version) {
        payload.app_version = diagnostics.app_version;
      }
      const text = JSON.stringify(payload, null, 2);
      if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
        throw new Error("Clipboard unavailable");
      }
      await navigator.clipboard.writeText(text);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("error");
    }
  }, [diagnostics]);

  const legacyBusy = actionBusy === "legacy";
  const resetBusy = actionBusy === "reset";

  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-12">
      <div className="surface-panel w-full max-w-2xl p-8 md:p-10">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">Recovery Mode</h1>
          <p className="text-secondary text-base">
            Taskify detected a problem during the storage update. You can recover your data and try again.
          </p>
        </div>

        <div className="mt-6 space-y-3">
          <button
            type="button"
            className="accent-button accent-button--tall pressable w-full"
            onClick={handleStartLegacyMode}
            disabled={Boolean(actionBusy)}
          >
            {legacyBusy ? "Starting legacy mode..." : "Start in Legacy Mode"}
          </button>
          <button
            type="button"
            className="ghost-button accent-button--tall pressable w-full"
            onClick={handleResetMigration}
            disabled={Boolean(actionBusy)}
          >
            {resetBusy ? "Resetting migration..." : "Reset Migration (keep my data)"}
          </button>
          <button
            type="button"
            className="ghost-button accent-button--tall pressable w-full"
            onClick={handleRetryNormalMode}
            disabled={Boolean(actionBusy)}
          >
            Retry Normal Startup
          </button>
          {actionError ? <div className="text-sm text-tertiary">{actionError}</div> : null}
        </div>

        <details className="mt-6">
          <summary className="text-sm font-semibold cursor-pointer">Details</summary>
          <div className="mt-4 space-y-4">
            <div className="grid gap-2 text-sm text-secondary">
              <div className="flex items-center justify-between gap-4">
                <span>migration_state</span>
                <span className="text-primary">{diagnostics.migration_state ?? "null"}</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span>migration_deferred</span>
                <span className="text-primary">{String(diagnostics.migration_deferred)}</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span>force_legacy_mode</span>
                <span className="text-primary">{String(diagnostics.force_legacy_mode)}</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span>force_recovery_prompt</span>
                <span className="text-primary">{String(diagnostics.force_recovery_prompt)}</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span>boot_attempts</span>
                <span className="text-primary">{String(diagnostics.boot_attempts)}</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span>last_boot_ts</span>
                <span className="text-primary">{String(diagnostics.last_boot_ts)}</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span>last_boot_ok_ts</span>
                <span className="text-primary">{String(diagnostics.last_boot_ok_ts)}</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span>indexeddb_open</span>
                <span className="text-primary">{statusToDisplay(idbOpenStatus)}</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span>indexeddb_delete</span>
                <span className="text-primary">{statusToDisplay(idbDeleteStatus)}</span>
              </div>
              {diagnostics.app_version ? (
                <div className="flex items-center justify-between gap-4">
                  <span>app_version</span>
                  <span className="text-primary">{diagnostics.app_version}</span>
                </div>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className="ghost-button pressable" onClick={handleCopyDiagnostics}>
                Copy diagnostics
              </button>
              {copyStatus === "copied" ? (
                <span className="text-sm text-secondary">Diagnostics copied</span>
              ) : null}
              {copyStatus === "error" ? (
                <span className="text-sm text-tertiary">Unable to copy diagnostics.</span>
              ) : null}
            </div>
          </div>
        </details>
      </div>
    </div>
  );
}

export default RecoveryScreen;
