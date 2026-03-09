import test from "node:test";
import assert from "node:assert/strict";
import { SwapManager } from "./SwapManager.ts";

type Proof = { amount?: number; secret?: string; C?: string; id?: string };

test("swap throws when wallet.swap is not supported", async () => {
  const connection: any = {
    requestCache: { buildKey: () => "k" },
    wallet: {},
    init: async () => {},
    runWithRateLimit: async (_k: string, fn: () => Promise<unknown>) => fn(),
    validateProofsDleq: (proofs: Proof[]) => proofs,
  };

  const manager = new SwapManager(connection);
  await assert.rejects(() => manager.swap([], []), /not supported/i);
});

test("swap calls init, wallet.swap, validateProofsDleq, and uses ttlMs:0", async () => {
  const calls: Record<string, unknown> = {};
  const outputs: Proof[] = [{ amount: 2, id: "out-1" }];
  const inputs: Proof[] = [{ amount: 1, secret: "s1", C: "c1" }];
  const swappedProofs: Proof[] = [{ amount: 2, secret: "new" }];

  const connection: any = {
    requestCache: {
      buildKey: (method: string, path: string, suffix: string) => {
        calls.buildKey = { method, path, suffix };
        return `key:${method}:${path}:${suffix}`;
      },
    },
    wallet: {
      swap: async (inProofs: Proof[], outProofs: Proof[]) => {
        calls.walletSwap = { inProofs, outProofs };
        return { proofs: swappedProofs };
      },
    },
    init: async () => {
      calls.init = true;
    },
    runWithRateLimit: async (key: string, fn: () => Promise<Proof[]>, options: { ttlMs: number }) => {
      calls.rateLimit = { key, options };
      return fn();
    },
    validateProofsDleq: (proofs: Proof[]) => {
      calls.validate = proofs;
      return proofs;
    },
  };

  const manager = new SwapManager(connection);
  const result = await manager.swap(inputs as any, outputs as any);

  assert.equal(calls.init, true);
  assert.deepEqual(calls.walletSwap, { inProofs: inputs, outProofs: outputs });
  assert.deepEqual(calls.validate, swappedProofs);
  assert.deepEqual(result, swappedProofs);

  const rateLimit = calls.rateLimit as { key: string; options: { ttlMs: number } };
  assert.equal(rateLimit.options.ttlMs, 0);
  assert.match(rateLimit.key, /^key:POST:swap:/);
});

test("swap accepts wallet response as direct proof array", async () => {
  const direct: Proof[] = [{ amount: 5, secret: "z" }];
  const connection: any = {
    requestCache: { buildKey: () => "k" },
    wallet: { swap: async () => direct },
    init: async () => {},
    runWithRateLimit: async (_k: string, fn: () => Promise<Proof[]>) => fn(),
    validateProofsDleq: (proofs: Proof[]) => proofs,
  };

  const manager = new SwapManager(connection);
  const result = await manager.swap([{ secret: "in" } as any], [{ amount: 5 } as any]);
  assert.deepEqual(result, direct);
});
