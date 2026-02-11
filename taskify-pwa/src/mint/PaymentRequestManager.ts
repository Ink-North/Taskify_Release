import type { MintConnection } from "./MintConnection";

export class PaymentRequestManager {
  private readonly connection: MintConnection;
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(connection: MintConnection) {
    this.connection = connection;
  }

  async executeOnce<T>(requestId: string, work: () => Promise<T>): Promise<T> {
    const normalized = requestId.trim();
    if (this.inFlight.has(normalized)) {
      return this.inFlight.get(normalized) as Promise<T>;
    }
    const promise = (async () => {
      await this.connection.init();
      try {
        return await work();
      } finally {
        this.inFlight.delete(normalized);
      }
    })();
    this.inFlight.set(normalized, promise);
    return promise;
  }
}
