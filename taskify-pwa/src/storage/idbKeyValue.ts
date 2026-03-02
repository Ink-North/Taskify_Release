import { idbStorage } from "./idbStorage.ts";
import { getTaskifyDb } from "./taskifyDb.ts";

type StoreState = {
  loaded: Set<string>;
  values: Map<string, string>;
  writeChain: Promise<void>;
};

const stores = new Map<string, StoreState>();

function getStoreState(storeName: string): StoreState {
  const existing = stores.get(storeName);
  if (existing) return existing;
  const created: StoreState = { loaded: new Set(), values: new Map(), writeChain: Promise.resolve() };
  stores.set(storeName, created);
  return created;
}

async function loadKeyFromIdb(storeName: string, key: string): Promise<string | null> {
  try {
    const db = await getTaskifyDb();
    const value = await idbStorage.get<string>(db, storeName, key);
    if (typeof value === "string") return value;
    if (value !== undefined) return null;
  } catch {
    return null;
  }
  return null;
}

function queueWrite(storeName: string, fn: () => Promise<void>): void {
  const state = getStoreState(storeName);
  state.writeChain = state.writeChain
    .then(async () => {
      await fn();
    })
    .catch((err) => {
      console.warn(`[idbKeyValue] Write failed for store "${storeName}":`, err);
    });
}

export const idbKeyValue = {
  async initStore(storeName: string, keys: string[]): Promise<void> {
    const state = getStoreState(storeName);
    const uniqueKeys = Array.from(
      new Set(
        (Array.isArray(keys) ? keys : [])
          .filter((key): key is string => typeof key === "string" && key.trim().length > 0)
          .map((key) => key.trim()),
      ),
    );

    await Promise.all(
      uniqueKeys.map(async (key) => {
        if (state.loaded.has(key)) return;
        const raw = await loadKeyFromIdb(storeName, key);
        if (raw === null) {
          state.values.delete(key);
        } else {
          state.values.set(key, raw);
        }
        state.loaded.add(key);
      }),
    );
  },

  getItem(storeName: string, key: string): string | null {
    const state = getStoreState(storeName);
    if (!state.loaded.has(key)) return null;
    return state.values.get(key) ?? null;
  },

  setItem(storeName: string, key: string, value: string): void {
    const state = getStoreState(storeName);
    state.loaded.add(key);
    state.values.set(key, value);
    queueWrite(storeName, async () => {
      const db = await getTaskifyDb();
      await idbStorage.put<string>(db, storeName, value, key);
    });
  },

  removeItem(storeName: string, key: string): void {
    const state = getStoreState(storeName);
    state.loaded.add(key);
    state.values.delete(key);
    queueWrite(storeName, async () => {
      const db = await getTaskifyDb();
      await idbStorage.delete(db, storeName, key);
    });
  },
};
