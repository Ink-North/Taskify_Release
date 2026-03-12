import { sha256, b64encode, b64decode } from "./nostrPrimitives.js";
export async function boardTagHash(boardId) {
    const digest = await sha256(new TextEncoder().encode(boardId));
    return Array.from(digest).map((x) => x.toString(16).padStart(2, "0")).join("");
}
async function deriveBoardAesKey(boardId) {
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(boardId));
    return crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
export async function encryptToBoard(boardId, plaintext) {
    const key = await deriveBoardAesKey(boardId);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const pt = new TextEncoder().encode(plaintext);
    const ctBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, pt);
    const combined = new Uint8Array(iv.length + ctBuf.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ctBuf), iv.length);
    return b64encode(combined);
}
export async function decryptFromBoard(boardId, data) {
    const key = await deriveBoardAesKey(boardId);
    const bytes = b64decode(data);
    const iv = bytes.slice(0, 12);
    const ct = bytes.slice(12);
    const ptBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
    return new TextDecoder().decode(ptBuf);
}
