import type { Proof, Secret } from "@cashu/cashu-ts";

function parseP2PKSecretString(secret: string): Secret | null {
  if (!secret || typeof secret !== "string") return null;
  try {
    const parsed = JSON.parse(secret);
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === "string" &&
      typeof parsed[1] === "object" &&
      parsed[1] !== null
    ) {
      return parsed as Secret;
    }
  } catch {
    return null;
  }
  return null;
}

function normalizePubkeyHex(value?: string | null): string | null {
  if (!value) return null;
  const hex = value.trim().toLowerCase();
  if (/^(02|03)[0-9a-f]{64}$/.test(hex)) return hex;
  if (/^[0-9a-f]{64}$/.test(hex)) return `02${hex}`;
  if (/^04[0-9a-f]{128}$/.test(hex)) return `02${hex.slice(2, 66)}`;
  return null;
}

export function extractPubkeysFromP2PKSecret(secret: string): string[] {
  const parsed = parseP2PKSecretString(secret);
  if (!parsed) return [];
  const [, data] = parsed;
  if (!data || typeof data !== "object") return [];
  const keys = new Set<string>();
  const addKey = (value?: string) => {
    const normalized = normalizePubkeyHex(value);
    if (normalized) keys.add(normalized);
  };
  addKey((data as any).data);
  if (Array.isArray((data as any).tags)) {
    for (const tag of (data as any).tags as unknown[]) {
      if (!Array.isArray(tag) || tag.length < 2) continue;
      const [tagName, ...values] = tag;
      if (tagName === "pubkeys" || tagName === "refund") {
        values.forEach((value) => addKey(typeof value === "string" ? value : undefined));
      }
    }
  }
  return Array.from(keys);
}

export function proofIsLockedToPubkey(proof: Proof, pubkey: string): boolean {
  const normalizedTarget = normalizePubkeyHex(pubkey);
  if (!normalizedTarget) return false;
  const secret = typeof proof?.secret === "string" ? proof.secret : "";
  if (!secret) return false;
  const keys = extractPubkeysFromP2PKSecret(secret);
  return keys.includes(normalizedTarget);
}

