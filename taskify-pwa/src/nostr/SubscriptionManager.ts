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

type PendingEvent = { raw: NostrEvent; relayUrl?: string };

type SubscriptionState = {
  key: string;
  subscription: NDKSubscription;
  filters: NDKFilter[];
  relayUrls: string[];
  handlers: Set<Handler>;
  refCount: number;
  seenIds: Set<string>;
  /** Events buffered for frame-budgeted dispatch. */
  pendingEvents: PendingEvent[];
  /** Whether a flush has already been scheduled. */
  flushScheduled: boolean;
};

/**
 * Maximum seenIds per subscription before FIFO eviction kicks in.
 * Prevents unbounded memory growth under heavy relay floods.
 */
const MAX_SEEN_IDS = 4096;

/**
 * Maximum events dispatched to handlers per flush frame.
 * Keeps each flush ≤ ~8 ms to avoid janking the main thread.
 */
const FLUSH_BATCH_SIZE = 64;

/** Schedule fn on the next animation frame, or a setTimeout(0) fallback. */
function scheduleFrame(fn: () => void): void {
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(fn);
  } else {
    setTimeout(fn, 0);
  }
}

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
    else if (key.startsWith("#") && Array.isArray(value)) {
      (normalized as Record<string, unknown>)[key] = uniqueSorted(
        value.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean),
      );
    }
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

  /**
   * Schedule a frame-budgeted flush of pendingEvents for a subscription.
   * Events are dispatched to handlers in batches of FLUSH_BATCH_SIZE per frame
   * so long startup relay bursts do not stall the main thread.
   */
  private scheduleFlush(state: SubscriptionState): void {
    if (state.flushScheduled) return;
    state.flushScheduled = true;
    scheduleFrame(() => {
      this.flushPending(state);
    });
  }

  private flushPending(state: SubscriptionState): void {
    state.flushScheduled = false;
    const batch = state.pendingEvents.splice(0, FLUSH_BATCH_SIZE);
    for (const { raw, relayUrl } of batch) {
      state.handlers.forEach((h) => {
        try {
          h.onEvent?.(raw, relayUrl);
        } catch {
          // Isolate handler errors so one bad handler can't kill the rest
        }
      });
    }
    // If more events queued during flush, schedule another frame
    if (state.pendingEvents.length > 0) {
      this.scheduleFlush(state);
    }
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

    const state: SubscriptionState = {
      key,
      subscription: null!,
      filters: normalized,
      relayUrls,
      handlers: new Set(handler.onEvent || handler.onEose ? [handler] : []),
      refCount: 1,
      seenIds: new Set<string>(),
      pendingEvents: [],
      flushScheduled: false,
    };
    // Store state and register handlers BEFORE creating the subscription
    // to avoid a race where events arrive before handlers are attached
    this.subs.set(key, state);

    const sub = this.ndk.subscribe(normalized, opts);
    state.subscription = sub;

    sub.on("event", (evt: NDKEvent) => {
      // Safety: malformed events from relays must not crash the subscription
      let raw: NostrEvent;
      try {
        raw = evt.rawEvent() as NostrEvent;
      } catch {
        return;
      }
      if (!raw?.id || typeof raw.id !== "string") return;
      if (state.seenIds.has(raw.id)) return;

      state.seenIds.add(raw.id);
      // Bounded seenIds: FIFO eviction prevents unbounded memory growth under relay floods
      if (state.seenIds.size > MAX_SEEN_IDS) {
        const [oldest] = state.seenIds;
        if (oldest) state.seenIds.delete(oldest);
      }

      this.eventCache?.add(raw);
      if (raw.created_at && Number.isFinite(raw.created_at)) {
        this.cursorStore.updateMany(state.filters, raw.created_at);
      }

      // Buffer for frame-budgeted dispatch to avoid main-thread stalls on startup bursts
      state.pendingEvents.push({ raw, relayUrl: evt.relay?.url });
      this.scheduleFlush(state);
    });

    sub.on("eose", () => {
      state.handlers.forEach((h) => {
        try {
          h.onEose?.();
        } catch {
          // Isolate handler errors
        }
      });
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
