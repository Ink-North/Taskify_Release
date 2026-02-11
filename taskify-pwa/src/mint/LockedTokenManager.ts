import type { Proof } from "@cashu/cashu-ts";
import type { MintConnection } from "./MintConnection";

export class LockedTokenManager {
  private readonly connection: MintConnection;

  constructor(connection: MintConnection) {
    this.connection = connection;
  }

  async autoSign(proofs: Proof[]): Promise<Proof[]> {
    await this.connection.init();
    // CashuManager already auto-signs P2PK proofs internally during receive/mint flows,
    // so we simply return the proofs here to keep the call site centralized.
    return proofs;
  }
}
