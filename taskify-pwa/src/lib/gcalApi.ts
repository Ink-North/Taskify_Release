// Helper for signing Worker API requests for Google Calendar endpoints.
// Uses the same Nostr privkey the app already holds.

import { schnorr } from "@noble/curves/secp256k1";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";

const WORKER_BASE = "https://taskify.solife.me";

export async function signGcalHeaders(
  privkeyHex: string,
  body: string = "",
): Promise<Record<string, string>> {
  const ts = Math.floor(Date.now() / 1000).toString();
  const payload = `${ts}.${body}`;
  const msgHash = sha256(new TextEncoder().encode(payload));
  const sigBytes = schnorr.sign(msgHash, privkeyHex);
  const pubkey = bytesToHex(schnorr.getPublicKey(privkeyHex));
  return {
    "X-Taskify-Npub": pubkey,
    "X-Taskify-Timestamp": ts,
    "X-Taskify-Sig": bytesToHex(sigBytes),
  };
}

export async function gcalFetch(
  path: string,
  privkeyHex: string,
  options: RequestInit = {},
): Promise<Response> {
  const body = typeof options.body === "string" ? options.body : "";
  const authHeaders = await signGcalHeaders(privkeyHex, body);
  return fetch(`${WORKER_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders,
      ...(options.headers as Record<string, string> | undefined),
    },
  });
}
