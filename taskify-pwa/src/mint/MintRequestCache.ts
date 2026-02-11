type CacheEntry<T> = {
  promise: Promise<T>;
  expiry: number | null;
};

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a > b ? 1 : -1));
  const normalized = entries.map(([k, v]) => `"${k}":${stableStringify(v)}`).join(",");
  return `{${normalized}}`;
}

export class MintRequestCache {
  private cache = new Map<string, CacheEntry<unknown>>();

  constructor(private readonly defaultTtlMs = 0) {}

  buildKey(method: string, path: string, payload?: unknown): string {
    const normalizedMethod = method.trim().toUpperCase();
    const normalizedPath = path.trim();
    const payloadKey = payload === undefined ? "" : stableStringify(payload);
    return `${normalizedMethod}|${normalizedPath}|${payloadKey}`;
  }

  async getOrCreate<T>(key: string, factory: () => Promise<T>, ttlMs?: number): Promise<T> {
    const now = Date.now();
    const entry = this.cache.get(key);
    if (entry && (entry.expiry === null || entry.expiry > now)) {
      return entry.promise as Promise<T>;
    }
    const expiresInMs = ttlMs ?? this.defaultTtlMs;
    const expiry = expiresInMs > 0 ? now + expiresInMs : now + 1;
    const promise = factory().finally(() => {
      const current = this.cache.get(key);
      if (!current) return;
      const stillValid = current.expiry === null || current.expiry > Date.now();
      if (!stillValid) {
        this.cache.delete(key);
      }
    });
    this.cache.set(key, { promise, expiry });
    promise.catch(() => {
      // remove failed entries to allow retries
      this.cache.delete(key);
    });
    return promise;
  }

  evict(key: string) {
    this.cache.delete(key);
  }

  clear() {
    this.cache.clear();
  }
}
