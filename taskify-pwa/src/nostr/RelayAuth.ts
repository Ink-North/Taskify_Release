import NDK, { NDKEvent, NDKKind, NDKPrivateKeySigner, type NDKRelay } from "@nostr-dev-kit/ndk";
import { LS_NOSTR_SK } from "../nostrKeys";
import { kvStorage } from "../storage/kvStorage";

type AuthState = { challenge: string; authedAt: number };

export class RelayAuthManager {
  private readonly ndk: NDK;
  private readonly authPerConnection = new Map<string, AuthState>();

  constructor(ndk: NDK) {
    this.ndk = ndk;
  }

  private connectionKey(relay: NDKRelay): string {
    const connectedAt = relay.connectionStats?.connectedAt;
    return `${relay.url}|${connectedAt ?? "none"}`;
  }

  private loadSigner(): NDKPrivateKeySigner | null {
    if (!kvStorage.isAvailable()) return null;
    const raw = (kvStorage.getItem(LS_NOSTR_SK) || "").trim();
    if (!/^[0-9a-fA-F]{64}$/.test(raw)) return null;
    return new NDKPrivateKeySigner(raw.toLowerCase());
  }

  async buildAuthEvent(relayUrl: string, challenge: string): Promise<NDKEvent | null> {
    const signer = this.loadSigner();
    if (!signer) return null;
    const event = new NDKEvent(this.ndk);
    event.kind = NDKKind.ClientAuth;
    event.tags = [
      ["relay", relayUrl],
      ["challenge", challenge],
    ];
    event.content = "";
    await event.sign(signer);
    return event;
  }

  async respond(relay: NDKRelay, challenge: string): Promise<NDKEvent | undefined> {
    const key = this.connectionKey(relay);
    const previous = this.authPerConnection.get(key);
    if (previous && previous.challenge === challenge && Date.now() - previous.authedAt < 15_000) {
      return undefined;
    }
    const event = await this.buildAuthEvent(relay.url, challenge);
    if (!event) return undefined;
    this.authPerConnection.set(key, { challenge, authedAt: Date.now() });
    return event;
  }

  markAuthed(relay: NDKRelay): void {
    const key = this.connectionKey(relay);
    const existing = this.authPerConnection.get(key);
    if (existing) {
      this.authPerConnection.set(key, { ...existing, authedAt: Date.now() });
    } else {
      this.authPerConnection.set(key, { challenge: "", authedAt: Date.now() });
    }
  }

  reset(relayUrl: string): void {
    const keys = Array.from(this.authPerConnection.keys());
    keys.forEach((key) => {
      if (key.startsWith(`${relayUrl}|`)) {
        this.authPerConnection.delete(key);
      }
    });
  }
}
