import type NDK from "@nostr-dev-kit/ndk";
import type {
  NDKEvent,
  NDKFilter,
  NDKRelaySet,
  NDKSubscription,
  NDKSubscriptionOptions,
} from "@nostr-dev-kit/ndk";
import type { NostrEvent } from "nostr-tools";
import { CursorStore } from "./CursorStore";
import { EventCache } from "./EventCache";

type RelayResolver = (relayUrls?: string[]) => Promise<NDKRelaySet | undefined>;
type RelayLimitResolver = (relayUrls: string[]) => Promise<number | null>;

export type SubscribeOptions = {
  relayUrls?: string[];
  onEvent?: (event: NostrEvent, relay?: string) => void;
  onEose?: (relay?: string) => void;
  skipSince?: boolean;
  opts?: NDKSubscriptionOptions;
};

export type ManagedSubscription = {
  key: string;
  subscription: NDKSubscription;
  release: () => void;
  filters: NDKFilter[];
  relayUrls: string[];
};

type Handler = { onEvent?: (event: NostrEvent, relay?: string) => void; onEose?: (relay?: string) => void };

type SubscriptionState = {
  key: string;
  subscription: NDKSubscription;
  filters: NDKFilter[];
  relayUrls: string[];
  handlers: Set<Handler>;
  refCount: number;
  seenIds: Set<string>;
};

function normalizeRelayList(relays?: string[]): string[] {
  const set = new Set(
    (Array.isArray(relays) ? relays : [])
      .map((r) => (typeof r === "string" ? r.trim() : ""))
      .filter(Boolean),
  );
  return Array.from(set).sort();
}

function uniqueSorted<T>(values: T[], sortFn?: (a: T, b: T) => number): T[] {
  const set = new Set(values);
  return Array.from(set).sort(sortFn as any);
}

function normalizeFilter(filter: NDKFilter): NDKFilter {
  const normalized: NDKFilter = {};
  Object.entries(filter).forEach(([key, value]) => {
    if (value == null) return;
    if (key === "kinds" && Array.isArray(value)) normalized.kinds = uniqueSorted(value.filter((v): v is number => typeof v === "number"), (a, b) => a - b);
    else if (key === "authors" && Array.isArray(value)) normalized.authors = uniqueSorted(value.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean));
    else if (key.startsWith("#") && Array.isArray(value)) normalized[key] = uniqueSorted(value.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean));
    else if (key === "since" || key === "until" || key === "limit") {
      const num = Number(value);
      if (Number.isFinite(num)) (normalized as any)[key] = num;
    } else {
      (normalized as any)[key] = value as any;
    }
  });
  return normalized;
}

function stableStringify(filter: NDKFilter): string {
  const ordered: Record<string, unknown> = {};
  Object.keys(filter)
    .sort()
    .forEach((key) => {
      const value = (filter as any)[key];
      if (Array.isArray(value)) {
        ordered[key] = value.slice();
      } else {
        ordered[key] = value;
      }
    });
  return JSON.stringify(ordered);
}

export class SubscriptionManager {
  private readonly ndk: NDK;
  private readonly cursorStore: CursorStore;
  private readonly eventCache?: EventCache;
  private readonly resolveRelaySet: RelayResolver;
  private readonly relayLimitResolver?: RelayLimitResolver;
  private readonly subs = new Map<string, SubscriptionState>();

  constructor(
    ndk: NDK,
    cursorStore: CursorStore,
    resolveRelaySet: RelayResolver,
    eventCache?: EventCache,
    relayLimitResolver?: RelayLimitResolver,
  ) {
    this.ndk = ndk;
    this.cursorStore = cursorStore;
    this.resolveRelaySet = resolveRelaySet;
    this.eventCache = eventCache;
    this.relayLimitResolver = relayLimitResolver;
  }

  private async clampFilters(filters: NDKFilter[], relayUrls: string[]): Promise<NDKFilter[]> {
    if (!this.relayLimitResolver || !relayUrls.length) return filters;
    try {
      const maxLimit = await this.relayLimitResolver(relayUrls);
      const safeLimit = Number.isFinite(maxLimit) && maxLimit ? maxLimit : 5000;
      return filters.map((f) => {
        if (f.limit && f.limit > safeLimit) {
          return { ...f, limit: safeLimit };
        }
        return f;
      });
    } catch {
      return filters;
    }
  }

  private async normalizeFilters(
    filters: NDKFilter[],
    relayUrls: string[],
    skipSince?: boolean,
  ): Promise<{ normalized: NDKFilter[]; key: string }> {
    const normalized = await this.clampFilters(
      filters.map((f) => {
        const nf = normalizeFilter(f);
        if (!skipSince && nf.since == null) {
          const since = this.cursorStore.getSince(nf);
          if (since) nf.since = since;
        }
        return nf;
      }),
      relayUrls,
    );
    const signature = normalized.map((f) => stableStringify(f)).sort().join("|");
    const relayKey = relayUrls.join(",");
    return { normalized, key: `${relayKey}|${signature}` };
  }

  async subscribe(filtersInput: NDKFilter | NDKFilter[], options?: SubscribeOptions): Promise<ManagedSubscription> {
    const filters = Array.isArray(filtersInput) ? filtersInput : [filtersInput];
    const relayUrls = normalizeRelayList(options?.relayUrls);
    const { normalized, key } = await this.normalizeFilters(filters, relayUrls, options?.skipSince);
    const existing = this.subs.get(key);
    const handler: Handler = { onEvent: options?.onEvent, onEose: options?.onEose };

    if (existing) {
      existing.refCount += 1;
      existing.handlers.add(handler);
      return {
        key,
        subscription: existing.subscription,
        release: () => this.release(key, handler),
        filters: existing.filters,
        relayUrls: existing.relayUrls,
      };
    }

    const relaySet = await this.resolveRelaySet(relayUrls);
    const opts: NDKSubscriptionOptions = {
      ...options?.opts,
      closeOnEose: options?.opts?.closeOnEose ?? false,
      relaySet,
    };

    const sub = this.ndk.subscribe(normalized, opts);
    const state: SubscriptionState = {
      key,
      subscription: sub,
      filters: normalized,
      relayUrls,
      handlers: new Set(handler.onEvent || handler.onEose ? [handler] : []),
      refCount: 1,
      seenIds: new Set<string>(),
    };
    this.subs.set(key, state);

    sub.on("event", (evt: NDKEvent) => {
      const raw = evt.rawEvent() as NostrEvent;
      if (!raw?.id || state.seenIds.has(raw.id)) return;
      state.seenIds.add(raw.id);
      this.eventCache?.add(raw);
      if (raw.created_at) {
        this.cursorStore.updateMany(state.filters, raw.created_at);
      }
      state.handlers.forEach((h) => h.onEvent?.(raw, evt.relay?.url));
    });

    sub.on("eose", (relayUrl?: string) => {
      state.handlers.forEach((h) => h.onEose?.(relayUrl));
    });

    return {
      key,
      subscription: sub,
      release: () => this.release(key, handler),
      filters: normalized,
      relayUrls,
    };
  }

  private release(key: string, handler?: Handler) {
    const state = this.subs.get(key);
    if (!state) return;
    if (handler) state.handlers.delete(handler);
    state.refCount -= 1;
    if (state.refCount > 0) return;
    try {
      state.subscription.stop();
    } catch {
      // ignore stop errors
    }
    this.subs.delete(key);
  }

  shutdown() {
    for (const [key, state] of this.subs) {
      try {
        state.subscription.stop();
      } catch {
        // ignore
      }
      this.subs.delete(key);
    }
  }
}
