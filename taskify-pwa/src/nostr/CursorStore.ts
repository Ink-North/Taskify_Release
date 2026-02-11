import type { NDKFilter } from "@nostr-dev-kit/ndk";

type FilterKeyParts = {
  kinds?: number[];
  authors?: string[];
  tagKeys: Array<{ key: string; values: string[] }>;
};

function normalizeStrings(values?: string[]): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  values.forEach((v) => {
    if (typeof v === "string" && v.trim()) {
      seen.add(v.trim());
    }
  });
  return Array.from(seen).sort();
}

function normalizeNumbers(values?: number[]): number[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<number>();
  values.forEach((v) => {
    if (typeof v === "number" && Number.isFinite(v)) {
      seen.add(v);
    }
  });
  return Array.from(seen).sort((a, b) => a - b);
}

function extractKeyParts(filter: NDKFilter): FilterKeyParts {
  const kinds = normalizeNumbers(filter.kinds);
  const authors = normalizeStrings(filter.authors as string[] | undefined);
  const tagKeys = Object.entries(filter)
    .filter(([key]) => key.startsWith("#"))
    .map(([key, value]) => ({
      key,
      values: normalizeStrings(value as string[] | undefined),
    }))
    .filter((entry) => entry.values.length > 0)
    .sort((a, b) => a.key.localeCompare(b.key));
  return { kinds, authors, tagKeys };
}

export class CursorStore {
  private lastSeen = new Map<string, number>();

  private keyForParts(parts: FilterKeyParts): string {
    const kinds = parts.kinds?.length ? parts.kinds.join(",") : "*";
    const authors = parts.authors?.length ? parts.authors.join(",") : "*";
    const tags = parts.tagKeys
      .map((entry) => `${entry.key}:${entry.values.join(",")}`)
      .join("|");
    return `k:${kinds}|a:${authors}|t:${tags}`;
  }

  keyFor(filter: NDKFilter): string {
    return this.keyForParts(extractKeyParts(filter));
  }

  getSince(filter: NDKFilter): number | undefined {
    const key = this.keyFor(filter);
    return this.lastSeen.get(key);
  }

  update(filter: NDKFilter, createdAt?: number): void {
    if (!createdAt || !Number.isFinite(createdAt)) return;
    const key = this.keyFor(filter);
    const prev = this.lastSeen.get(key) || 0;
    if (createdAt > prev) {
      this.lastSeen.set(key, createdAt);
    }
  }

  updateMany(filters: NDKFilter[], createdAt?: number): void {
    filters.forEach((filter) => this.update(filter, createdAt));
  }
}
