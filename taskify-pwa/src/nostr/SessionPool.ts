import type { NDKFilter } from "@nostr-dev-kit/ndk";
import type { NostrEvent } from "nostr-tools";
import { NostrSession } from "./NostrSession";

type SubscribeManyOptions = {
  onevent?: (event: NostrEvent) => void;
  oneose?: (relay?: string) => void;
  closeOnEose?: boolean;
};

function normalizeRelays(relays: string[]): string[] {
  return Array.from(
    new Set(
      (Array.isArray(relays) ? relays : [])
        .map((r) => (typeof r === "string" ? r.trim() : ""))
        .filter(Boolean),
    ),
  ).sort();
}

export class SessionPool {
  async list(relays: string[], filters: NDKFilter[]): Promise<NostrEvent[]> {
    const relayList = normalizeRelays(relays);
    const session = await NostrSession.init(relayList);
    return session.fetchEvents(filters, relayList);
  }

  async querySync(
    relays: string[],
    filter: NDKFilter | NDKFilter[],
    opts?: { maxWait?: number; label?: string },
  ): Promise<NostrEvent[]> {
    const relayList = normalizeRelays(relays);
    const filters = Array.isArray(filter) ? filter : [filter];
    const session = await NostrSession.init(relayList);
    const fetchPromise = session.fetchEvents(filters, relayList);
    if (opts?.maxWait && Number.isFinite(opts.maxWait)) {
      return Promise.race<NostrEvent[]>([
        fetchPromise,
        new Promise<NostrEvent[]>((resolve) => setTimeout(() => resolve([]), opts.maxWait)),
      ]);
    }
    return fetchPromise;
  }

  subscribe(
    relays: string[],
    filters: NDKFilter[],
    onEvent: (event: NostrEvent, relay?: string) => void,
    onEose?: (relay?: string) => void,
    closeOnEose?: boolean,
  ): () => void {
    let release: (() => void) | null = null;
    // Track cleanup requests that arrive before the subscription promise resolves
    let cleanupRequested = false;
    const relayList = normalizeRelays(relays);
    NostrSession.init(relayList)
      .then((session) =>
        session.subscribe(filters, {
          relayUrls: relayList,
          onEvent,
          onEose,
          opts: { closeOnEose: !!closeOnEose },
        }),
      )
      .then((managed) => {
        if (cleanupRequested) {
          // Cleanup was requested before we resolved — release immediately
          try { managed.release(); } catch { /* ignore */ }
        } else {
          release = managed.release;
        }
      })
      .catch((err) => {
        if ((import.meta as any)?.env?.DEV) {
          console.warn("[SessionPool] subscribe failed", err);
        }
      });
    return () => {
      cleanupRequested = true;
      try {
        release?.();
      } catch {
        // ignore
      }
    };
  }

  subscribeMany(relays: string[], filter: NDKFilter | NDKFilter[], opts?: SubscribeManyOptions) {
    const relayList = normalizeRelays(relays);
    let release: (() => void) | null = null;
    // Track cleanup requests that arrive before the subscription promise resolves
    let cleanupRequested = false;
    NostrSession.init(relayList)
      .then((session) =>
        session.subscribe(Array.isArray(filter) ? filter : [filter], {
          relayUrls: relayList,
          onEvent: opts?.onevent,
          onEose: opts?.oneose,
          opts: { closeOnEose: !!opts?.closeOnEose },
        }),
      )
      .then((managed) => {
        if (cleanupRequested) {
          // Cleanup was requested before we resolved — release immediately
          try { managed.release(); } catch { /* ignore */ }
        } else {
          release = managed.release;
        }
      })
      .catch((err) => {
        if ((import.meta as any)?.env?.DEV) {
          console.warn("[SessionPool] subscribeMany failed", err);
        }
      });

    return {
      close: () => {
        cleanupRequested = true;
        try {
          release?.();
        } catch {
          // ignore
        }
      },
    };
  }

  async get(relays: string[], filter: NDKFilter): Promise<NostrEvent | null> {
    const events = await this.list(relays, [filter]);
    if (!events.length) return null;
    return events.reduce((latest, ev) => {
      if (!latest) return ev;
      return (ev.created_at || 0) > (latest.created_at || 0) ? ev : latest;
    }, events[0] as NostrEvent);
  }

  publish(relays: string[], event: NostrEvent): Promise<unknown> {
    const relayList = normalizeRelays(relays);
    return NostrSession.init(relayList).then((session) =>
      session.publishRaw(event, { relayUrls: relayList, returnEvent: false }),
    );
  }

  publishEvent(relays: string[], event: NostrEvent): Promise<unknown> {
    return this.publish(relays, event);
  }

  close() {
    // Managed centrally by NostrSession; no-op for compatibility.
  }
}
