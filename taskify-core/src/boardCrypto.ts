import { sha256, b64encode, b64decode } from "./nostrPrimitives.js";

export async function boardTagHash(boardId: string): Promise<string> {
  const digest = await sha256(new TextEncoder().encode(boardId));
  return Array.from(digest).map((x) => x.toString(16).padStart(2, "0")).join("");
}

// Cache derived AES keys per boardId. The key material is deterministic (boardId only),
// so one derivation per board is sufficient for the lifetime of the session.
// Without this, every decryptFromBoard call ran SHA-256 + importKey — 2 async WebCrypto
// ops per event × 500 events = 1000 serial operations that blocked the queue for minutes.
const aesKeyCache = new Map<string, Promise<CryptoKey>>();

async function deriveBoardAesKey(boardId: string): Promise<CryptoKey> {
  const cached = aesKeyCache.get(boardId);
  if (cached) return cached;
  const promise = (async () => {
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(boardId));
    return crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  })();
  aesKeyCache.set(boardId, promise);
  return promise;
}

export async function encryptToBoard(boardId: string, plaintext: string): Promise<string> {
  const key = await deriveBoardAesKey(boardId);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const pt = new TextEncoder().encode(plaintext);
  const ctBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, pt);
  const combined = new Uint8Array(iv.length + ctBuf.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ctBuf), iv.length);
  return b64encode(combined);
}

export async function decryptFromBoard(boardId: string, data: string): Promise<string> {
  const key = await deriveBoardAesKey(boardId);
  const bytes = b64decode(data);
  const iv = bytes.slice(0, 12);
  const ct = bytes.slice(12);
  const ptBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(ptBuf);
}
