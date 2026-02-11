import NDK, { NDKRelaySet, type NDKFilter, type NDKRelay } from "@nostr-dev-kit/ndk";
import type { EventTemplate, NostrEvent } from "nostr-tools";
import { CursorStore } from "./CursorStore";
import { SubscriptionManager, type ManagedSubscription, type SubscribeOptions } from "./SubscriptionManager";
import { PublishCoordinator, type PublishResult } from "./PublishCoordinator";
import { BoardKeyManager } from "./BoardKeyManager";
import { WalletNostrClient } from "./WalletNostrClient";
import { EventCache } from "./EventCache";
import { RelayInfoCache, type RelayLimits } from "./RelayInfoCache";
import { RelayHealthTracker } from "./RelayHealth";
import { RelayAuthManager } from "./RelayAuth";
import type { RelayInfo } from "./RelayInfoCache";

function normalizeRelays(relays: string[]): string[] {
  const set = new Set(
    relays
      .map((r) => (typeof r === "string" ? r.trim() : ""))
      .filter(Boolean),
  );
  return Array.from(set).sort();
}

export class NostrSession {
  private static singleton: NostrSession | null = null;
  private ndk: NDK;
  private initialized = false;
  private knownRelays: Set<string>;
  private relayInfoCache: RelayInfoCache;
  private relayHealth: RelayHealthTracker;
  private authManager: RelayAuthManager;
  private relayRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private loggedDebugSummary = false;

  readonly cache: EventCache;
  readonly cursors: CursorStore;
  readonly subscriptions: SubscriptionManager;
  readonly publisher: PublishCoordinator;
  readonly boardKeys: BoardKeyManager;
  readonly walletClient: WalletNostrClient;

  private constructor(relays: string[]) {
    this.knownRelays = new Set(relays);
    this.ndk = new NDK({
      explicitRelayUrls: relays,
      enableOutboxModel: true,
      autoConnectUserRelays: false,
    });
    this.relayInfoCache = new RelayInfoCache();
    this.relayHealth = new RelayHealthTracker();
    this.authManager = new RelayAuthManager(this.ndk);
    this.cache = new EventCache();
    this.cursors = new CursorStore();
    const relayResolver = this.buildRelaySet.bind(this);
    this.publisher = new PublishCoordinator(this.ndk, relayResolver, this.cache);
    this.subscriptions = new SubscriptionManager(
      this.ndk,
      this.cursors,
      relayResolver,
      this.cache,
      this.resolveRelayLimit.bind(this),
    );
    this.boardKeys = new BoardKeyManager();
    this.walletClient = new WalletNostrClient(this.ndk, this.publisher, this.subscriptions, relayResolver);
    this.setupRelayHooks();
  }

  static get instance(): NostrSession {
    if (!this.singleton) {
      throw new Error("NostrSession not initialised");
    }
    return this.singleton;
  }

  static async init(relays: string[]): Promise<NostrSession> {
    const normalized = normalizeRelays(relays);
    if (!this.singleton) {
      this.singleton = new NostrSession(normalized);
      await this.singleton.ensureRelays(normalized);
      await this.singleton.connect();
      return this.singleton;
    }
    await this.singleton.ensureRelays(normalized);
    return this.singleton;
  }

  private async connect(): Promise<void> {
    if (this.initialized) return;
    await this.ndk.connect();
    this.logDebugSummary();
    this.initialized = true;
  }

  async shutdown(): Promise<void> {
    this.subscriptions.shutdown();
    try {
      await (this.ndk.pool as any)?.disconnect?.();
    } catch {
      // ignore
    }
    NostrSession.singleton = null;
  }

  private async buildRelaySet(relayUrls?: string[]): Promise<NDKRelaySet | undefined> {
    const relays = normalizeRelays(relayUrls || Array.from(this.knownRelays));
    if (!relays.length) return undefined;
    await this.ensureRelays(relays);
    const relayObjects = new Set<NDKRelay>();
    for (const relayUrl of relays) {
      const canConnect = this.relayHealth.canAttempt(relayUrl);
      try {
        const relay = this.ndk.pool.getRelay(relayUrl, canConnect);
        relayObjects.add(relay);
        if (!canConnect) this.scheduleRelayConnect(relayUrl);
      } catch {
        // ignore individual relay failures
      }
    }
    if (!relayObjects.size) return undefined;
    return new NDKRelaySet(relayObjects, this.ndk, this.ndk.pool);
  }

  private async ensureRelays(relays: string[]): Promise<void> {
    const list = normalizeRelays(relays);
    for (const relay of list) {
      this.primeRelayInfo(relay);
      if (this.knownRelays.has(relay)) continue;
      const canConnect = this.relayHealth.canAttempt(relay);
      try {
        this.ndk.addExplicitRelay(relay, undefined, canConnect);
        this.knownRelays.add(relay);
        if (!canConnect) this.scheduleRelayConnect(relay);
      } catch {
        // ignore individual relay failures
      }
    }
  }

  private async fetchRelayInfo(relayUrl: string): Promise<RelayInfo | null> {
    try {
      const cached = await this.relayInfoCache.prime(relayUrl, async (nip11Url) => {
        const res = await fetch(nip11Url, { headers: { Accept: "application/nostr+json" } });
        if (!res.ok) {
          this.relayHealth.markFailure(relayUrl, { severity: "low", reason: `nip11:${res.status}` });
          this.relayHealth.onBackoffExpiry(relayUrl, () => this.primeRelayInfo(relayUrl));
          return null;
        }
        const json = (await res.json()) as RelayInfo;
        this.relayHealth.markSuccess(relayUrl);
        return json;
      });
      return cached?.info ?? null;
    } catch {
      this.relayHealth.markFailure(relayUrl, { severity: "low", reason: "nip11:fetch" });
      this.relayHealth.onBackoffExpiry(relayUrl, () => this.primeRelayInfo(relayUrl));
      return null;
    }
  }

  private resolveRelayLimit(relayUrls: string[]): Promise<number> {
    const relays = normalizeRelays(relayUrls);
    relays.forEach((relay) => this.primeRelayInfo(relay));
    const limits: RelayLimits = this.relayInfoCache.getLimits(relays);
    return Promise.resolve(limits.maxLimit);
  }

  async subscribe(filters: NDKFilter | NDKFilter[], options?: SubscribeOptions): Promise<ManagedSubscription> {
    return this.subscriptions.subscribe(filters, options);
  }

  async publish(event: EventTemplate, options?: Parameters<PublishCoordinator["publish"]>[1]): Promise<PublishResult> {
    return this.publisher.publish(event, options);
  }

  async publishRaw(event: NostrEvent, options?: Parameters<PublishCoordinator["publish"]>[1]): Promise<PublishResult> {
    return this.publisher.publishRaw(event, options);
  }

  async fetchEvents(filters: NDKFilter[], relayUrls?: string[]): Promise<NostrEvent[]> {
    const relaySet = await this.buildRelaySet(relayUrls);
    const fetched = await this.ndk.fetchEvents(filters, { closeOnEose: true }, relaySet);
    return Array.from(fetched)
      .map((ev) => ev.rawEvent?.() ?? (ev as unknown as NostrEvent))
      .filter((ev): ev is NostrEvent => !!ev?.id);
  }

  private setupRelayHooks() {
    this.ndk.relayAuthDefaultPolicy = async (relay, challenge) => {
      console.info("[nostr][auth] Challenge received", { relay: relay.url, challenge });
      try {
        const event = await this.authManager.respond(relay, challenge);
        if (event) {
          console.info("[nostr][auth] Responding to challenge", { relay: relay.url });
        }
        return event ?? false;
      } catch (error) {
        console.warn("[nostr][auth] Failed to build auth event", { relay: relay.url, error });
        return false;
      }
    };

    this.ndk.pool.on("relay:connect", (relay: NDKRelay) => {
      this.relayHealth.markSuccess(relay.url);
      this.authManager.reset(relay.url);
      this.logDebugSummary();
    });

    this.ndk.pool.on("relay:ready", (relay: NDKRelay) => {
      this.relayHealth.markSuccess(relay.url);
    });

    this.ndk.pool.on("notice", (relay: NDKRelay, notice: string) => {
      if (typeof notice === "string" && notice.toLowerCase().includes("auth")) {
        console.info("[nostr][auth] Relay notice mentions auth", { relay: relay.url, notice });
      }
    });

    this.ndk.pool.on("relay:disconnect", (relay: NDKRelay) => {
      this.relayHealth.markFailure(relay.url, { reason: "disconnect" });
      this.authManager.reset(relay.url);
      this.scheduleRelayConnect(relay.url);
    });

    this.ndk.pool.on("relay:authed", (relay: NDKRelay) => {
      console.info("[nostr][auth] Authenticated", { relay: relay.url });
      this.authManager.markAuthed(relay);
      this.relayHealth.markSuccess(relay.url);
    });
  }

  private primeRelayInfo(relayUrl: string): void {
    if (!this.relayInfoCache.needsRefresh(relayUrl) && this.relayInfoCache.get(relayUrl)) return;
    if (!this.relayHealth.canAttempt(relayUrl)) {
      this.relayHealth.onBackoffExpiry(relayUrl, () => this.primeRelayInfo(relayUrl));
      return;
    }
    void this.fetchRelayInfo(relayUrl);
  }

  private scheduleRelayConnect(relayUrl: string): void {
    if (this.relayRetryTimers.has(relayUrl)) return;
    const delay = this.relayHealth.nextAttemptIn(relayUrl);
    const timer = setTimeout(() => {
      this.relayRetryTimers.delete(relayUrl);
      if (!this.relayHealth.canAttempt(relayUrl)) {
        this.scheduleRelayConnect(relayUrl);
        return;
      }
      try {
        const relay = this.ndk.pool.getRelay(relayUrl, true);
        const connectPromise = relay.connect?.();
        if (connectPromise?.catch) {
          connectPromise.catch(() => {});
        }
      } catch {
        // ignore
      }
    }, delay || 0);
    this.relayRetryTimers.set(relayUrl, timer);
  }

  private logDebugSummary() {
    if (this.loggedDebugSummary) return;
    if (!(import.meta as any)?.env?.DEV) return;
    this.loggedDebugSummary = true;
    const summary = Array.from(this.knownRelays).map((relayUrl) => {
      const ageMs = this.relayInfoCache.getAgeMs(relayUrl);
      const ageMinutes = ageMs != null ? Math.round(ageMs / 60000) : null;
      const limits = this.relayInfoCache.getLimits([relayUrl]);
      const health = this.relayHealth.status(relayUrl);
      return {
        relay: relayUrl,
        cacheAgeM: ageMinutes,
        authRequired: limits.authRequired,
        backoffMs: this.relayHealth.nextAttemptIn(relayUrl),
        failures: health?.consecutiveFailures ?? 0,
      };
    });
    console.debug("[nostr][debug] relay state", summary);
  }
}
