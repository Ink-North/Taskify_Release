import NDK from "@nostr-dev-kit/ndk";
import { RelayAuthManager as RuntimeRelayAuthManager } from "taskify-runtime-nostr";
import { LS_NOSTR_SK } from "../nostrKeys";
import { kvStorage } from "../storage/kvStorage";

export class RelayAuthManager extends RuntimeRelayAuthManager {
  constructor(ndk: NDK) {
    super(ndk, {
      loadSecretKeyHex: () => {
        if (!kvStorage.isAvailable()) return null;
        const raw = (kvStorage.getItem(LS_NOSTR_SK) || "").trim();
        return raw || null;
      },
    });
  }
}
