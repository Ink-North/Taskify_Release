import { nip04 } from "nostr-tools";
import { kvStorage } from "../../storage/kvStorage";
import { LS_NOSTR_SK } from "../../nostrKeys";

/* ================== Crypto helpers (AES-GCM via local Nostr key) ================== */
export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const h = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(h);
}
export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}
export function bytesToHex(b: Uint8Array): string {
  return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}
export function concatBytes(a: Uint8Array, b: Uint8Array) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a); out.set(b, a.length);
  return out;
}
export function b64encode(buf: ArrayBuffer | Uint8Array): string {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = ""; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}
export function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function deriveAesKeyFromLocalSk(): Promise<CryptoKey> {
  // Derive a stable AES key from local Nostr SK: AES-GCM 256 with SHA-256(sk || label)
  const skHex = kvStorage.getItem(LS_NOSTR_SK) || "";
  if (!skHex || !/^[0-9a-fA-F]{64}$/.test(skHex)) throw new Error("No local Nostr secret key");
  const label = new TextEncoder().encode("taskify-ecash-v1");
  const raw = concatBytes(hexToBytes(skHex), label);
  const digest = await sha256(raw);
  return await crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt","decrypt"]);
}
export async function encryptEcashTokenForFunder(plain: string): Promise<{alg:"aes-gcm-256";iv:string;ct:string}> {
  const key = await deriveAesKeyFromLocalSk();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ctBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain));
  return { alg: "aes-gcm-256", iv: b64encode(iv), ct: b64encode(ctBuf) };
}
export async function decryptEcashTokenForFunder(enc: {alg:"aes-gcm-256";iv:string;ct:string}): Promise<string> {
  if (enc.alg !== "aes-gcm-256") throw new Error("Unsupported cipher");
  const key = await deriveAesKeyFromLocalSk();
  const iv = b64decode(enc.iv);
  const ct = b64decode(enc.ct);
  const ptBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(new Uint8Array(ptBuf));
}

// NIP-04 encryption for recipient
export async function encryptEcashTokenForRecipient(recipientHex: string, plain: string): Promise<{ alg: "nip04"; data: string }> {
  const skHex = kvStorage.getItem(LS_NOSTR_SK) || "";
  if (!/^[0-9a-fA-F]{64}$/.test(skHex)) throw new Error("No local Nostr secret key");
  if (!/^[0-9a-fA-F]{64}$/.test(recipientHex)) throw new Error("Invalid recipient pubkey");
  const data = await nip04.encrypt(skHex, recipientHex, plain);
  return { alg: "nip04", data };
}

export async function decryptEcashTokenForRecipient(senderHex: string, enc: { alg: "nip04"; data: string }): Promise<string> {
  const skHex = kvStorage.getItem(LS_NOSTR_SK) || "";
  if (!/^[0-9a-fA-F]{64}$/.test(skHex)) throw new Error("No local Nostr secret key");
  if (!/^[0-9a-fA-F]{64}$/.test(senderHex)) throw new Error("Invalid sender pubkey");
  return await nip04.decrypt(skHex, senderHex, enc.data);
}

export const CLOUD_BACKUP_KEY_LABEL = new TextEncoder().encode("taskify-cloud-backup-v1");

export async function deriveBackupAesKey(skHex: string): Promise<CryptoKey> {
  const raw = concatBytes(hexToBytes(skHex), CLOUD_BACKUP_KEY_LABEL);
  const digest = await sha256(raw);
  return await crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptBackupWithSecretKey(skHex: string, plain: string): Promise<{ iv: string; ciphertext: string }> {
  const key = await deriveBackupAesKey(skHex);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ctBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain));
  return { iv: b64encode(iv), ciphertext: b64encode(ctBuf) };
}

export async function decryptBackupWithSecretKey(
  skHex: string,
  payload: { iv: string; ciphertext: string },
): Promise<string> {
  const key = await deriveBackupAesKey(skHex);
  const iv = b64decode(payload.iv);
  const ct = b64decode(payload.ciphertext);
  const ptBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(new Uint8Array(ptBuf));
}
