import {
  RuntimeNostrSession,
  type ManagedSubscription,
  type SubscribeOptions,
  type PublishResult,
} from "taskify-runtime-nostr";
import { RelayInfoCache } from "./RelayInfoCache";
import { RelayHealthTracker } from "./RelayHealth";
import { RelayAuthManager } from "./RelayAuth";
import { WalletNostrClient } from "./WalletNostrClient";

type PwaRuntimeSession = RuntimeNostrSession<WalletNostrClient>;

export class NostrSession {
  private static singleton: PwaRuntimeSession | null = null;

  static get instance(): PwaRuntimeSession {
    if (!this.singleton) throw new Error("NostrSession not initialised");
    return this.singleton;
  }

  static async init(relays: string[]): Promise<PwaRuntimeSession> {
    if (!this.singleton) {
      const relayInfoCache = new RelayInfoCache();
      const relayHealth = new RelayHealthTracker();
      this.singleton = new RuntimeNostrSession(relays, {
        relayInfoCache,
        relayHealth,
        createAuthManager: (ndk) => new RelayAuthManager(ndk),
        createWalletClient: ({ ndk, publisher, subscriptions, resolveRelaySet }) =>
          new WalletNostrClient(ndk, publisher, subscriptions, resolveRelaySet),
        isDev: Boolean((import.meta as any)?.env?.DEV),
      });
    }
    await this.singleton.init(relays);
    return this.singleton;
  }

  static async shutdown(): Promise<void> {
    if (!this.singleton) return;
    await this.singleton.shutdown();
    this.singleton = null;
  }
}

export type { ManagedSubscription, SubscribeOptions, PublishResult };
