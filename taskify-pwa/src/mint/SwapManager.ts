import type { Proof } from "@cashu/cashu-ts";
import type { MintConnection } from "./MintConnection";

export class SwapManager {
  private readonly connection: MintConnection;

  constructor(connection: MintConnection) {
    this.connection = connection;
  }

  private buildKey(inputs: Proof[], outputs: Proof[]) {
    const inputKey = inputs.map((p) => p?.secret || `${p?.C ?? ""}:${p?.amount ?? 0}`).join("|");
    const outputKey = outputs.map((p) => `${p?.amount ?? 0}:${p?.id ?? ""}`).join("|");
    return this.connection.requestCache.buildKey("POST", "swap", `${inputKey}->${outputKey}`);
  }

  async swap(inputs: Proof[], outputs: Proof[]): Promise<Proof[]> {
    await this.connection.init();
    const wallet: any = this.connection.wallet as any;
    if (typeof wallet?.swap !== "function") {
      throw new Error("Mint swap operation is not supported by this wallet");
    }
    const key = this.buildKey(inputs, outputs);
    return this.connection.runWithRateLimit(
      key,
      async () => {
        const res = await wallet.swap(inputs, outputs);
        const proofs: Proof[] = Array.isArray(res?.proofs) ? res.proofs : Array.isArray(res) ? res : [];
        return this.connection.validateProofsDleq(proofs);
      },
      { ttlMs: 0 },
    );
  }
}
