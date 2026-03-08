import test from "node:test";
import assert from "node:assert/strict";
import { extractPubkeysFromP2PKSecret, proofIsLockedToPubkey } from "./p2pk.ts";

const COMPRESSED_A = "02" + "11".repeat(32);
const COMPRESSED_B = "03" + "22".repeat(32);
const X_ONLY = "33".repeat(32);
const UNCOMPRESSED = "04" + "44".repeat(64);

function makeSecret(payload: unknown): string {
  return JSON.stringify(["P2PK", payload]);
}

test("extractPubkeysFromP2PKSecret returns empty on invalid JSON", () => {
  assert.deepEqual(extractPubkeysFromP2PKSecret("not-json"), []);
});

test("extractPubkeysFromP2PKSecret collects data + tags and dedupes", () => {
  const secret = makeSecret({
    data: COMPRESSED_A,
    tags: [
      ["pubkeys", COMPRESSED_A, COMPRESSED_B],
      ["refund", X_ONLY],
      ["pubkeys", COMPRESSED_B],
    ],
  });

  const keys = extractPubkeysFromP2PKSecret(secret);
  assert.equal(keys.length, 3);
  assert.ok(keys.includes(COMPRESSED_A.toLowerCase()));
  assert.ok(keys.includes(COMPRESSED_B.toLowerCase()));
  // x-only is normalized to compressed with 02 prefix
  assert.ok(keys.includes(("02" + X_ONLY).toLowerCase()));
});

test("extractPubkeysFromP2PKSecret normalizes uncompressed pubkeys", () => {
  const secret = makeSecret({ data: UNCOMPRESSED });
  const keys = extractPubkeysFromP2PKSecret(secret);
  assert.equal(keys.length, 1);
  assert.equal(keys[0], ("02" + "44".repeat(32)).toLowerCase());
});

test("proofIsLockedToPubkey returns true when target key is present", () => {
  const secret = makeSecret({
    data: COMPRESSED_A,
    tags: [["pubkeys", COMPRESSED_B]],
  });
  const proof: any = { secret };

  assert.equal(proofIsLockedToPubkey(proof, COMPRESSED_A), true);
  assert.equal(proofIsLockedToPubkey(proof, COMPRESSED_B), true);
});

test("proofIsLockedToPubkey returns false for missing/invalid key", () => {
  const secret = makeSecret({ data: COMPRESSED_A });
  const proof: any = { secret };

  assert.equal(proofIsLockedToPubkey(proof, COMPRESSED_B), false);
  assert.equal(proofIsLockedToPubkey(proof, "not-a-key"), false);
});
