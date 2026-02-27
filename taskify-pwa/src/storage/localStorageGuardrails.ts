/**
 * `localStorageGuardrails`
 * -----------------------
 * Dev-only warnings for accidental direct `localStorage` usage.
 *
 * Storage boundaries:
 * - `kvStorage` is the only module allowed to read/write `localStorage`.
 * - IndexedDB (`idbKeyValue` / `idbStorage`) holds domain persistence.
 *
 * In development, this module patches `Storage` methods and logs a warning if
 * `localStorage.*` is called outside `kvStorage`.
 */

const INSTALL_FLAG = Symbol.for("taskify.localStorageGuardrails.installed");
const WARNED_SET = Symbol.for("taskify.localStorageGuardrails.warned");

// Incremented by `kvStorage` around allowed `localStorage` calls in dev.
const KV_STORAGE_ACCESS_DEPTH = Symbol.for("taskify.kvStorage.localStorageAccessDepth");

type WarnedSet = Set<string>;

function getWarnedSet(): WarnedSet {
  const globalAny = globalThis as any;
  const existing = globalAny[WARNED_SET] as WarnedSet | undefined;
  if (existing) return existing;
  const created: WarnedSet = new Set();
  globalAny[WARNED_SET] = created;
  return created;
}

function getKvStorageDepth(): number {
  const value = (globalThis as any)?.[KV_STORAGE_ACCESS_DEPTH];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function shouldWarnForStack(stack: string | undefined): boolean {
  if (!stack) return true;
  // Only warn for Taskify source frames to avoid noise from third-party code in dev.
  // Ignore this guard module's own stack frame (it always matches `/src/`).
  return stack
    .split("\n")
    .some((line) => line.includes("/src/") && !line.includes("localStorageGuardrails") && !line.includes("node_modules"));
}

function warnOnce(id: string, message: string): void {
  const warned = getWarnedSet();
  if (warned.has(id)) return;
  warned.add(id);
  console.warn(message);
}

function installDevLocalStorageGuardrails(): void {
  if (!import.meta.env.DEV) return;
  if (typeof Storage === "undefined") return;

  const globalAny = globalThis as any;
  if (globalAny[INSTALL_FLAG]) return;
  globalAny[INSTALL_FLAG] = true;

  const proto = Storage.prototype as Storage;

  const wrap = <T extends (...args: any[]) => any>(
    methodName: keyof Storage,
    original: T,
    options?: { keyArgIndex?: number },
  ): T => {
    return function (this: unknown, ...args: any[]) {
      if (getKvStorageDepth() > 0) {
        return original.apply(this as any, args);
      }

      let isLocal = false;
      try {
        const local = (globalThis as any)?.localStorage;
        isLocal = Boolean(local) && this === local;
      } catch {
        isLocal = false;
      }

      if (isLocal) {
        const stack = (() => {
          try {
            return new Error().stack;
          } catch {
            return undefined;
          }
        })();
        if (shouldWarnForStack(stack)) {
          const key = options?.keyArgIndex !== undefined ? String(args[options.keyArgIndex] ?? "") : "";
          const id = key ? `${String(methodName)}:${key}` : String(methodName);
          const suffix = key ? ` (key="${key}")` : "";
          warnOnce(
            id,
            `[storage] Direct localStorage.${String(methodName)} usage detected${suffix}. Use kvStorage instead.\n${stack || ""}`.trimEnd(),
          );
        }
      }

      return original.apply(this as any, args);
    } as unknown as T;
  };

  try {
    const originalGetItem = proto.getItem;
    (Storage.prototype as any).getItem = wrap("getItem", originalGetItem, { keyArgIndex: 0 });
  } catch {}

  try {
    const originalSetItem = proto.setItem;
    (Storage.prototype as any).setItem = wrap("setItem", originalSetItem, { keyArgIndex: 0 });
  } catch {}

  try {
    const originalRemoveItem = proto.removeItem;
    (Storage.prototype as any).removeItem = wrap("removeItem", originalRemoveItem, { keyArgIndex: 0 });
  } catch {}

  try {
    const originalClear = proto.clear;
    (Storage.prototype as any).clear = wrap("clear", originalClear);
  } catch {}

  try {
    const originalKey = proto.key;
    (Storage.prototype as any).key = wrap("key", originalKey);
  } catch {}
}

installDevLocalStorageGuardrails();
