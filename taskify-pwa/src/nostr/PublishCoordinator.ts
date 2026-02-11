import { NDKEvent, NDKPrivateKeySigner, type NDKRelaySet, type NDKSigner } from "@nostr-dev-kit/ndk";
import type { EventTemplate, NostrEvent } from "nostr-tools";
import type NDK from "@nostr-dev-kit/ndk";
import { EventCache } from "./EventCache";

type RelayResolver = (relayUrls?: string[]) => Promise<NDKRelaySet | undefined>;

type PublishOptions = {
  relayUrls?: string[];
  signer?: NDKSigner | Uint8Array | string;
  replaceableKey?: string;
  debounceMs?: number;
  returnEvent?: boolean;
  skipIfIdentical?: boolean;
};

type PendingPublish = {
  event: NDKEvent;
  relaySet?: NDKRelaySet;
  resolvers: Array<(value: PublishResult) => void>;
  rejecters: Array<(error: unknown) => void>;
  timer: ReturnType<typeof setTimeout> | null;
};

export type PublishResult = number | { createdAt: number; event: NostrEvent };

function normalizeRelayList(relays?: string[]): string[] {
  const set = new Set(
    (Array.isArray(relays) ? relays : [])
      .map((r) => (typeof r === "string" ? r.trim() : ""))
      .filter(Boolean),
  );
  return Array.from(set).sort();
}

function signerFromInput(value?: NDKSigner | Uint8Array | string): NDKSigner | undefined {
  if (!value) return undefined;
  if (typeof value === "string") return new NDKPrivateKeySigner(value);
  if (value instanceof Uint8Array) {
    const hex = Array.from(value)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return new NDKPrivateKeySigner(hex);
  }
  return value;
}

function hashEventShape(event: NostrEvent): string {
  return JSON.stringify({
    kind: event.kind,
    content: event.content,
    tags: event.tags,
  });
}

export class PublishCoordinator {
  private replaceableCache = new Map<string, string>();
  private pending = new Map<string, PendingPublish>();
  private readonly debounceDefault = 350;
  private eventCache?: EventCache;
  private resolveRelaySet: RelayResolver;
  private ndk: NDK;

  constructor(ndk: NDK, resolveRelaySet: RelayResolver, cache?: EventCache) {
    this.ndk = ndk;
    this.resolveRelaySet = resolveRelaySet;
    this.eventCache = cache;
  }

  private buildReplaceableKey(event: NDKEvent): string | null {
    if (!event.isReplaceable()) return null;
    const pubkey = event.pubkey || event.author?.pubkey || "";
    if (!pubkey) return null;
    const dTag = event.tags.find((t) => t[0] === "d")?.[1] || "";
    if (event.isParamReplaceable()) {
      return `replaceable:${event.kind}:${pubkey}:${dTag}`;
    }
    return `replaceable:${event.kind}:${pubkey}`;
  }

  private async publishNow(event: NDKEvent, relaySet?: NDKRelaySet): Promise<PublishResult> {
    const createdAt = event.created_at || Math.floor(Date.now() / 1000);
    await event.publish(relaySet);
    const raw = event.rawEvent() as NostrEvent;
    this.eventCache?.add(raw);
    return { createdAt, event: raw };
  }

  private async resolveRelaySetWithEnsure(relayUrls?: string[]): Promise<NDKRelaySet | undefined> {
    return await this.resolveRelaySet(normalizeRelayList(relayUrls));
  }

  private scheduleDebouncedPublish(key: string, pending: PendingPublish, delayMs: number): void {
    if (pending.timer) clearTimeout(pending.timer);
    pending.timer = setTimeout(async () => {
      try {
        const result = await this.publishNow(pending.event, pending.relaySet);
        pending.resolvers.forEach((resolve) => resolve(result));
      } catch (error) {
        pending.rejecters.forEach((reject) => reject(error));
      } finally {
        this.pending.delete(key);
      }
    }, delayMs);
  }

  private shouldSkipReplaceable(key: string, event: NostrEvent, skipIfIdentical?: boolean): boolean {
    if (!skipIfIdentical) return false;
    const shape = hashEventShape(event);
    const prev = this.replaceableCache.get(key);
    if (prev === shape) return true;
    this.replaceableCache.set(key, shape);
    return false;
  }

  async publish(templateOrEvent: EventTemplate | NDKEvent, options?: PublishOptions): Promise<PublishResult> {
    const relaySet = await this.resolveRelaySetWithEnsure(options?.relayUrls);
    const signer = signerFromInput(options?.signer);

    const event =
      templateOrEvent instanceof NDKEvent
        ? templateOrEvent
        : new NDKEvent(this.ndk, {
            kind: templateOrEvent.kind,
            content: templateOrEvent.content || "",
            tags: templateOrEvent.tags || [],
            created_at: templateOrEvent.created_at || Math.floor(Date.now() / 1000),
          });

    if (!event.created_at) {
      event.created_at = Math.floor(Date.now() / 1000);
    }

    if (!event.sig || signer) {
      await event.sign(signer);
    }

    const raw = event.rawEvent() as NostrEvent;
    const replaceableKey =
      options?.replaceableKey || this.buildReplaceableKey(event) || (event.isReplaceable() ? event.deduplicationKey() : null);

    if (replaceableKey && this.shouldSkipReplaceable(replaceableKey, raw, options?.skipIfIdentical !== false)) {
      return options?.returnEvent ? { createdAt: raw.created_at, event: raw } : raw.created_at;
    }

    if (replaceableKey) {
      const existing = this.pending.get(replaceableKey);
      const delay = options?.debounceMs ?? this.debounceDefault;
      if (existing) {
        existing.event = event;
        existing.relaySet = relaySet;
        this.scheduleDebouncedPublish(replaceableKey, existing, delay);
        return new Promise<PublishResult>((resolve, reject) => {
          existing.resolvers.push(resolve);
          existing.rejecters.push(reject);
        });
      }
      const pending: PendingPublish = {
        event,
        relaySet,
        resolvers: [],
        rejecters: [],
        timer: null,
      };
      this.pending.set(replaceableKey, pending);
      this.scheduleDebouncedPublish(replaceableKey, pending, delay);
      return new Promise<PublishResult>((resolve, reject) => {
        pending.resolvers.push(resolve);
        pending.rejecters.push(reject);
      });
    }

    const result = await this.publishNow(event, relaySet);
    return options?.returnEvent ? result : result.createdAt;
  }

  async publishRaw(event: NostrEvent, options?: PublishOptions): Promise<PublishResult> {
    const ndkEvent = new NDKEvent(this.ndk, event);
    return this.publish(ndkEvent, options);
  }
}
