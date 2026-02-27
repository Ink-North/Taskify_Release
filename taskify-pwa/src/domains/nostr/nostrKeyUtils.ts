import { getPublicKey, nip19 } from "nostr-tools";
import { BoardKeyManager } from "../../nostr/BoardKeyManager";
import { hexToBytes, bytesToHex } from "./nostrCrypto";

export type BoardNostrKeyPair = {
  sk: Uint8Array;
  skHex: string;
  pk: string;
  npub: string;
  nsec: string;
};

const boardKeyManager = new BoardKeyManager();

export async function deriveBoardNostrKeys(boardId: string): Promise<BoardNostrKeyPair> {
  return boardKeyManager.getBoardKeys(boardId);
}

export function toNsec(secret: string): string {
  const trimmed = (secret || "").trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("nsec")) return trimmed;
  if (!/^[0-9a-fA-F]{64}$/.test(trimmed)) return trimmed;
  try {
    const skBytes = hexToBytes(trimmed);
    return typeof (nip19 as any)?.nsecEncode === "function" ? (nip19 as any).nsecEncode(skBytes) : trimmed;
  } catch {
    return trimmed;
  }
}

export function normalizeSecretKeyInput(raw: string): string | null {
  if (typeof raw !== "string") return null;
  let value = raw.trim();
  if (!value) return null;
  if (value.startsWith("nsec")) {
    try {
      const dec = nip19.decode(value);
      if (dec.type !== "nsec") return null;
      value = typeof dec.data === "string" ? dec.data : bytesToHex(dec.data as Uint8Array);
    } catch {
      return null;
    }
  }
  if (!/^[0-9a-fA-F]{64}$/.test(value)) return null;
  return value.toLowerCase();
}

export function deriveNpubFromSecretKeyHex(skHex: string): string | null {
  try {
    const pkHex = getPublicKey(hexToBytes(skHex));
    if (typeof (nip19 as any)?.npubEncode === "function") {
      return (nip19 as any).npubEncode(pkHex);
    }
    return pkHex;
  } catch {
    return null;
  }
}
