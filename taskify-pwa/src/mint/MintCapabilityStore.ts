import type { GetInfoResponse } from "@cashu/cashu-ts";

type CapabilityEntry = {
  info: GetInfoResponse;
  fetchedAt: number;
};

export class MintCapabilityStore {
  private readonly cache = new Map<string, CapabilityEntry>();
  private readonly ttlMs: number;

  constructor(options: { ttlMs?: number } = {}) {
    this.ttlMs = Math.max(options.ttlMs ?? 5 * 60 * 1000, 0);
  }

  private normalize(url: string): string {
    return url.trim().replace(/\/+$/, "");
  }

  getCached(mintUrl: string): GetInfoResponse | null {
    const normalized = this.normalize(mintUrl);
    const entry = this.cache.get(normalized);
    if (!entry) return null;
    if (this.ttlMs > 0 && entry.fetchedAt + this.ttlMs < Date.now()) {
      this.cache.delete(normalized);
      return null;
    }
    return entry.info;
  }

  set(mintUrl: string, info: GetInfoResponse) {
    const normalized = this.normalize(mintUrl);
    this.cache.set(normalized, { info, fetchedAt: Date.now() });
  }

  async get(
    mintUrl: string,
    fetcher: () => Promise<GetInfoResponse>,
  ): Promise<GetInfoResponse> {
    const normalized = this.normalize(mintUrl);
    const cached = this.getCached(normalized);
    if (cached) return cached;
    const res = await fetcher();
    if (res) {
      this.set(normalized, res);
    }
    return res;
  }
}
