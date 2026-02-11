import { kvStorage } from "./kvStorage";

/**
 * `legacyStorage`
 * --------------
 * Read-only access to legacy localStorage-backed persistence.
 *
 * IMPORTANT:
 * - This module must remain read-only.
 * - This module must not touch `localStorage` directly (only `kvStorage` may in prod).
 */
export const legacyStorage = {
  isAvailable(): boolean {
    return kvStorage.isAvailable();
  },

  getItem(key: string): string | null {
    return kvStorage.getItem(key);
  },
};
