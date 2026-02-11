function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

type RateLimitSignal = {
  throttleMs?: number;
  slow?: boolean;
};

export class MintRateLimiter {
  private backoffMs = 0;
  private lastStartedAt = 0;
  private readonly minIntervalMs: number;
  private readonly maxBackoffMs: number;

  constructor(options: { minIntervalMs?: number; maxBackoffMs?: number } = {}) {
    this.minIntervalMs = Math.max(options.minIntervalMs ?? 120, 0);
    this.maxBackoffMs = Math.max(options.maxBackoffMs ?? 5000, this.minIntervalMs);
  }

  private async delayForSchedule() {
    const now = Date.now();
    const earliest = this.lastStartedAt + this.minIntervalMs + this.backoffMs;
    const waitMs = Math.max(earliest - now, 0);
    if (waitMs > 0) {
      await wait(waitMs);
    }
  }

  private registerSignal(signal?: RateLimitSignal) {
    if (!signal) return;
    if (signal.throttleMs && signal.throttleMs > 0) {
      this.backoffMs = Math.min(this.maxBackoffMs, Math.max(this.backoffMs, signal.throttleMs));
    } else if (signal.slow) {
      this.backoffMs = Math.min(this.maxBackoffMs, Math.max(this.backoffMs, this.minIntervalMs));
    }
  }

  private relax() {
    if (this.backoffMs <= this.minIntervalMs) {
      this.backoffMs = 0;
      return;
    }
    this.backoffMs = Math.floor(this.backoffMs / 2);
  }

  async schedule<T>(fn: () => Promise<T>, signal?: RateLimitSignal): Promise<T> {
    await this.delayForSchedule();
    this.lastStartedAt = Date.now();
    try {
      const result = await fn();
      this.relax();
      return result;
    } catch (err: any) {
      const status = (err as any)?.response?.status ?? (err as any)?.status ?? null;
      if (status === 429) {
        this.registerSignal({ throttleMs: this.maxBackoffMs });
      } else {
        this.registerSignal(signal);
      }
      throw err;
    }
  }
}
