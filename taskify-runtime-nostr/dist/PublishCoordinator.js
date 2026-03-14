import { NDKEvent, NDKPrivateKeySigner } from "@nostr-dev-kit/ndk";
import { normalizeRelayUrls } from "./relayUrls.js";
function signerFromInput(value) {
    if (!value)
        return undefined;
    if (typeof value === "string")
        return new NDKPrivateKeySigner(value);
    if (value instanceof Uint8Array) {
        const hex = Array.from(value)
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
        return new NDKPrivateKeySigner(hex);
    }
    return value;
}
function hashEventShape(event) {
    return JSON.stringify({
        kind: event.kind,
        content: event.content,
        tags: event.tags,
    });
}
export class PublishCoordinator {
    replaceableCache = new Map();
    pending = new Map();
    debounceDefault = 350;
    eventCache;
    resolveRelaySet;
    ndk;
    constructor(ndk, resolveRelaySet, cache) {
        this.ndk = ndk;
        this.resolveRelaySet = resolveRelaySet;
        this.eventCache = cache;
    }
    buildReplaceableKey(event) {
        if (!event.isReplaceable())
            return null;
        const pubkey = event.pubkey || event.author?.pubkey || "";
        if (!pubkey)
            return null;
        const dTag = event.tags.find((t) => t[0] === "d")?.[1] || "";
        if (event.isParamReplaceable())
            return `replaceable:${event.kind}:${pubkey}:${dTag}`;
        return `replaceable:${event.kind}:${pubkey}`;
    }
    async publishNow(event, relaySet) {
        const createdAt = event.created_at || Math.floor(Date.now() / 1000);
        await event.publish(relaySet);
        const raw = event.rawEvent();
        this.eventCache?.add(raw);
        return { createdAt, event: raw };
    }
    async resolveRelaySetWithEnsure(relayUrls) {
        return this.resolveRelaySet(normalizeRelayUrls(relayUrls || []));
    }
    scheduleDebouncedPublish(key, pending, delayMs) {
        if (pending.timer)
            clearTimeout(pending.timer);
        pending.timer = setTimeout(async () => {
            try {
                const result = await this.publishNow(pending.event, pending.relaySet);
                pending.resolvers.forEach((resolve) => resolve(result));
            }
            catch (error) {
                pending.rejecters.forEach((reject) => reject(error));
            }
            finally {
                this.pending.delete(key);
            }
        }, delayMs);
    }
    shouldSkipReplaceable(key, event, skipIfIdentical) {
        if (!skipIfIdentical)
            return false;
        const shape = hashEventShape(event);
        const prev = this.replaceableCache.get(key);
        if (prev === shape)
            return true;
        this.replaceableCache.set(key, shape);
        return false;
    }
    async publish(templateOrEvent, options) {
        const relaySet = await this.resolveRelaySetWithEnsure(options?.relayUrls);
        const signer = signerFromInput(options?.signer);
        const event = templateOrEvent instanceof NDKEvent
            ? templateOrEvent
            : new NDKEvent(this.ndk, {
                kind: templateOrEvent.kind,
                content: templateOrEvent.content || "",
                tags: templateOrEvent.tags || [],
                created_at: templateOrEvent.created_at || Math.floor(Date.now() / 1000),
            });
        if (!event.created_at)
            event.created_at = Math.floor(Date.now() / 1000);
        if (!event.sig || signer)
            await event.sign(signer);
        const raw = event.rawEvent();
        const replaceableKey = options?.replaceableKey || this.buildReplaceableKey(event) || (event.isReplaceable() ? event.deduplicationKey() : null);
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
                return new Promise((resolve, reject) => {
                    existing.resolvers.push(resolve);
                    existing.rejecters.push(reject);
                });
            }
            const pending = { event, relaySet, resolvers: [], rejecters: [], timer: null };
            this.pending.set(replaceableKey, pending);
            this.scheduleDebouncedPublish(replaceableKey, pending, delay);
            return new Promise((resolve, reject) => {
                pending.resolvers.push(resolve);
                pending.rejecters.push(reject);
            });
        }
        const result = await this.publishNow(event, relaySet);
        return options?.returnEvent ? result : result.createdAt;
    }
    async publishRaw(event, options) {
        const ndkEvent = new NDKEvent(this.ndk, event);
        return this.publish(ndkEvent, options);
    }
}
