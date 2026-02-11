const MIGRATION_RELOAD_GUARD_KEY = "taskify.storageMigration.reload.guard.v1";
const MIGRATION_RELOAD_GUARD_WINDOW_MS = 30000;

type MigrationReloadGuard = {
  count: number;
  lastAt: number;
};

function readMigrationReloadGuard(): MigrationReloadGuard {
  if (typeof window === "undefined") return { count: 0, lastAt: 0 };
  try {
    const raw = window.sessionStorage.getItem(MIGRATION_RELOAD_GUARD_KEY);
    if (!raw) return { count: 0, lastAt: 0 };
    const parsed = JSON.parse(raw) as Partial<MigrationReloadGuard>;
    const count = typeof parsed.count === "number" && Number.isFinite(parsed.count) ? parsed.count : 0;
    const lastAt = typeof parsed.lastAt === "number" && Number.isFinite(parsed.lastAt) ? parsed.lastAt : 0;
    return { count, lastAt };
  } catch {
    return { count: 0, lastAt: 0 };
  }
}

function writeMigrationReloadGuard(state: MigrationReloadGuard): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(MIGRATION_RELOAD_GUARD_KEY, JSON.stringify(state));
  } catch {
    // ignore sessionStorage failures
  }
}

export function shouldSkipMigrationReload(now: number): boolean {
  const guard = readMigrationReloadGuard();
  return guard.count >= 1 && now - guard.lastAt < MIGRATION_RELOAD_GUARD_WINDOW_MS;
}

export function recordMigrationReload(now: number): void {
  const guard = readMigrationReloadGuard();
  const withinWindow = guard.lastAt > 0 && now - guard.lastAt < MIGRATION_RELOAD_GUARD_WINDOW_MS;
  const count = withinWindow ? guard.count + 1 : 1;
  writeMigrationReloadGuard({ count, lastAt: now });
}
