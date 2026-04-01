import {
  RelayInfoCache as RuntimeRelayInfoCache,
  type RelayLimitation,
  type RelayInfo,
  type CachedRelayInfo,
  type RelayLimits,
  normalizeRelayCacheKey,
  buildNip11Url,
} from "taskify-runtime-nostr";
import { LS_RELAY_INFO_CACHE } from "../localStorageKeys";
import { idbKeyValue } from "../storage/idbKeyValue";
import { TASKIFY_STORE_NOSTR } from "../storage/taskifyDb";

export type { RelayLimitation, RelayInfo, CachedRelayInfo, RelayLimits };
export { normalizeRelayCacheKey, buildNip11Url };

export class RelayInfoCache extends RuntimeRelayInfoCache {
  constructor(ttlMs?: number) {
    super({
      ttlMs,
      storageKey: LS_RELAY_INFO_CACHE,
      storage: {
        getItem: (key) => idbKeyValue.getItem(TASKIFY_STORE_NOSTR, key),
        setItem: (key, value) => idbKeyValue.setItem(TASKIFY_STORE_NOSTR, key, value),
      },
    });
  }
}
