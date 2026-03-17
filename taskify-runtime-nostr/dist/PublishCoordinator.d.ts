import { NDKEvent, type NDKRelaySet, type NDKSigner } from "@nostr-dev-kit/ndk";
import type NDK from "@nostr-dev-kit/ndk";
import type { EventTemplate, NostrEvent } from "nostr-tools";
import { EventCache } from "./EventCache.js";
export type RelayResolver = (relayUrls?: string[]) => Promise<NDKRelaySet | undefined>;
export type PublishOptions = {
    relayUrls?: string[];
    signer?: NDKSigner | Uint8Array | string;
    replaceableKey?: string;
    debounceMs?: number;
    returnEvent?: boolean;
    skipIfIdentical?: boolean;
};
export type PublishResult = number | {
    createdAt: number;
    event: NostrEvent;
};
export declare class PublishCoordinator {
    private replaceableCache;
    private pending;
    private readonly debounceDefault;
    private eventCache?;
    private resolveRelaySet;
    private ndk;
    constructor(ndk: NDK, resolveRelaySet: RelayResolver, cache?: EventCache);
    private buildReplaceableKey;
    private publishNow;
    private resolveRelaySetWithEnsure;
    private scheduleDebouncedPublish;
    private shouldSkipReplaceable;
    publish(templateOrEvent: EventTemplate | NDKEvent, options?: PublishOptions): Promise<PublishResult>;
    publishRaw(event: NostrEvent, options?: PublishOptions): Promise<PublishResult>;
}
