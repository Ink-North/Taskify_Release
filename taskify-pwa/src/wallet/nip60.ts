import type { Proof } from "@cashu/cashu-ts";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { getPublicKey, nip44, type Event as NostrEvent, type EventTemplate } from "nostr-tools";
import { DEFAULT_NOSTR_RELAYS } from "../lib/relays";
import { LS_NOSTR_RELAYS } from "../nostrKeys";
import { kvStorage } from "../storage/kvStorage";
import { idbKeyValue } from "../storage/idbKeyValue";
import { TASKIFY_STORE_WALLET } from "../storage/taskifyDb";

export const NIP60_WALLET_KIND = 17375;
export const NIP60_TOKEN_KIND = 7375;
export const NIP60_HISTORY_KIND = 7376;

const LS_NIP60_STATE = "cashu_nip60_state_v1";
const LS_NIP60_QUEUE = "cashu_nip60_queue_v1";

export type Nip60WalletSnapshot = {
  id: string;
  created_at: number;
  hash: string;
  privkey?: string | null;
};

export type Nip60TokenSnapshot = {
  id: string;
  created_at: number;
  hash: string;
};

export type Nip60HistorySnapshot = {
  id: string;
  created_at: number;
  hash: string;
  entryId?: string;
};

export type Nip60SyncState = {
  wallet?: Nip60WalletSnapshot;
  tokens: Record<string, Nip60TokenSnapshot>;
  history: Record<string, Nip60HistorySnapshot>;
};

export type Nip60QueuedEvent = {
  id: string;
  type: "wallet" | "token" | "delete" | "history";
  mint?: string;
  hash?: string;
  created_at: number;
  relays: string[];
  event: NostrEvent;
};

export type ParsedWalletEvent = {
  id: string;
  created_at?: number;
  mints: string[];
  walletPrivkey?: string | null;
};

export type ParsedTokenEvent = {
  id: string;
  created_at?: number;
  mint: string;
  unit?: string;
  proofs: Proof[];
  del?: string[];
};

export type ParsedHistoryEvent = {
  id: string;
  created_at?: number;
  entryId?: string;
  direction?: string;
  amount?: number;
  unit?: string;
  summary?: string;
  mint?: string;
  feeSat?: number;
  detail?: string;
  detailKind?: string;
  revertToken?: string;
  fiatValueUsd?: number;
  stateLabel?: string;
  pendingTokenId?: string;
  pendingTokenAmount?: number;
  pendingTokenMint?: string;
  pendingStatus?: "pending" | "redeemed";
  tokenState?: unknown;
  mintQuote?: unknown;
  relatedTaskTitle?: string;
};

function ensureNip44V2() {
  if (!nip44?.v2) {
    throw new Error("NIP-44 v2 encryption is unavailable.");
  }
  return nip44.v2;
}

export function normalizeMintUrl(url: string): string {
  return (url || "").trim().replace(/\/+$/, "");
}

export function loadDefaultNostrRelays(): string[] {
  try {
    const raw = kvStorage.getItem(LS_NOSTR_RELAYS);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.every((entry) => typeof entry === "string")) {
        return arr.map((entry) => entry.trim()).filter(Boolean);
      }
    }
  } catch {
    // ignore parse errors and fall back
  }
  return DEFAULT_NOSTR_RELAYS.slice();
}

export function deriveWalletPrivkey(seed: Uint8Array): string {
  const domainSeparator = new TextEncoder().encode("cashu-nip60-wallet");
  const combined = new Uint8Array(seed.length + domainSeparator.length);
  combined.set(seed);
  combined.set(domainSeparator, seed.length);
  return bytesToHex(sha256(combined));
}

export function hashProofs(proofs: Proof[]): string {
  const normalized = (Array.isArray(proofs) ? proofs : [])
    .map((proof) => ({
      amount: proof?.amount || 0,
      secret: proof?.secret || "",
      id: proof?.id || "",
      C: proof?.C || "",
    }))
    .sort((a, b) => a.secret.localeCompare(b.secret));
  const raw = JSON.stringify(normalized);
  return bytesToHex(sha256(new TextEncoder().encode(raw)));
}

export function hashMints(mints: string[], privkey?: string | null): string {
  const normalized = Array.from(
    new Set(
      (Array.isArray(mints) ? mints : [])
        .map((mint) => normalizeMintUrl(mint))
        .filter(Boolean),
    ),
  ).sort();
  const raw = JSON.stringify({ mints: normalized, privkey: privkey || "" });
  return bytesToHex(sha256(new TextEncoder().encode(raw)));
}

export function loadNip60SyncState(): Nip60SyncState {
  try {
    const raw = idbKeyValue.getItem(TASKIFY_STORE_WALLET, LS_NIP60_STATE);
    if (!raw) return { tokens: {}, history: {} };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { tokens: {}, history: {} };
    const tokens: Record<string, Nip60TokenSnapshot> = {};
    if (parsed.tokens && typeof parsed.tokens === "object") {
      for (const [mint, value] of Object.entries(parsed.tokens as Record<string, any>)) {
        if (!mint || typeof value !== "object") continue;
        const id = typeof (value as any).id === "string" ? (value as any).id : "";
        const created_at = Number((value as any).created_at) || 0;
        const hash = typeof (value as any).hash === "string" ? (value as any).hash : "";
        if (!id || !hash) continue;
        tokens[mint] = { id, created_at, hash };
      }
    }
    let wallet: Nip60WalletSnapshot | undefined;
    if (parsed.wallet && typeof parsed.wallet === "object") {
      const rawWallet = parsed.wallet as any;
      const id = typeof rawWallet.id === "string" ? rawWallet.id : "";
      const hash = typeof rawWallet.hash === "string" ? rawWallet.hash : "";
      const created_at = Number(rawWallet.created_at) || 0;
      const privkey =
        typeof rawWallet.privkey === "string" && rawWallet.privkey.trim()
          ? rawWallet.privkey.trim()
          : undefined;
      if (id && hash) {
        wallet = { id, hash, created_at, privkey };
      }
    }
    const history: Record<string, Nip60HistorySnapshot> = {};
    if (parsed.history && typeof parsed.history === "object") {
      for (const [key, value] of Object.entries(parsed.history as Record<string, any>)) {
        if (!key || typeof value !== "object") continue;
        const id = typeof (value as any).id === "string" ? (value as any).id : "";
        const created_at = Number((value as any).created_at) || 0;
        const hash = typeof (value as any).hash === "string" ? (value as any).hash : "";
        const entryId = typeof (value as any).entryId === "string" ? (value as any).entryId : undefined;
        if (!id || !hash) continue;
        history[key] = { id, created_at, hash, entryId };
      }
    }
    return { wallet, tokens, history };
  } catch {
    return { tokens: {}, history: {} };
  }
}

export function persistNip60SyncState(state: Nip60SyncState) {
  try {
    idbKeyValue.setItem(TASKIFY_STORE_WALLET, LS_NIP60_STATE, JSON.stringify(state));
  } catch {
    // ignore persistence issues
  }
}

export function loadNip60Queue(): Nip60QueuedEvent[] {
  try {
    const raw = idbKeyValue.getItem(TASKIFY_STORE_WALLET, LS_NIP60_QUEUE);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry: any) => {
        if (!entry || typeof entry !== "object") return null;
        const id = typeof entry.id === "string" ? entry.id : "";
        const created_at = Number(entry.created_at) || 0;
        const relays = Array.isArray(entry.relays) ? entry.relays.filter((r) => typeof r === "string") : [];
        const type =
          entry.type === "wallet" || entry.type === "token" || entry.type === "delete" || entry.type === "history"
            ? entry.type
            : null;
        const event = entry.event;
        if (!id || !created_at || !relays.length || !type || !event) return null;
        return {
          id,
          created_at,
          relays,
          type,
          mint: typeof entry.mint === "string" ? entry.mint : undefined,
          hash: typeof entry.hash === "string" ? entry.hash : undefined,
          event,
        } as Nip60QueuedEvent;
      })
      .filter((entry): entry is Nip60QueuedEvent => !!entry);
  } catch {
    return [];
  }
}

export function persistNip60Queue(queue: Nip60QueuedEvent[]) {
  try {
    idbKeyValue.setItem(TASKIFY_STORE_WALLET, LS_NIP60_QUEUE, JSON.stringify(queue));
  } catch {
    // ignore persistence issues
  }
}

async function encryptForSelf(payload: unknown, sk: string, pk: string): Promise<string> {
  const nip44v2 = ensureNip44V2();
  const conversationKey = nip44v2.utils.getConversationKey(sk, pk);
  return nip44v2.encrypt(JSON.stringify(payload), conversationKey);
}

async function decryptForSelf(ciphertext: string, sk: string, pk: string): Promise<string> {
  const nip44v2 = ensureNip44V2();
  const conversationKey = nip44v2.utils.getConversationKey(sk, pk);
  return nip44v2.decrypt(ciphertext, conversationKey);
}

export async function createWalletEventTemplate(
  mints: string[],
  walletPrivkey: string | null | undefined,
  keys: { sk: string; pk: string },
  options?: { createdAt?: number },
): Promise<EventTemplate> {
  const normalizedMints = Array.from(
    new Set(
      (Array.isArray(mints) ? mints : [])
        .map((mint) => normalizeMintUrl(mint))
        .filter(Boolean),
    ),
  );
  const payload: Array<[string, string]> = [];
  if (walletPrivkey) {
    payload.push(["privkey", walletPrivkey]);
  }
  for (const mint of normalizedMints) {
    payload.push(["mint", mint]);
  }
  const created_at = options?.createdAt ?? Math.floor(Date.now() / 1000);
  const content = await encryptForSelf(payload, keys.sk, keys.pk);
  const tags = normalizedMints.map((mint) => ["mint", mint]);
  return {
    kind: NIP60_WALLET_KIND,
    content,
    tags,
    created_at,
  };
}

export async function createTokenEventTemplate(
  mint: string,
  proofs: Proof[],
  keys: { sk: string; pk: string },
  options?: { del?: string[]; unit?: string; createdAt?: number },
): Promise<EventTemplate> {
  const payload: Record<string, unknown> = {
    mint: normalizeMintUrl(mint),
    proofs: Array.isArray(proofs) ? proofs : [],
  };
  if (options?.unit) payload.unit = options.unit;
  if (Array.isArray(options?.del) && options.del.length) {
    payload.del = options.del.filter((id) => typeof id === "string" && id.trim());
  }
  const created_at = options?.createdAt ?? Math.floor(Date.now() / 1000);
  const content = await encryptForSelf(payload, keys.sk, keys.pk);
  return {
    kind: NIP60_TOKEN_KIND,
    content,
    tags: [],
    created_at,
  };
}

export async function parseWalletEvent(
  event: { id?: string; content?: string; tags?: string[][]; created_at?: number },
  keys: { sk: string; pk: string },
): Promise<ParsedWalletEvent | null> {
  if (!event?.id || !event.content) return null;
  try {
    const plaintext = await decryptForSelf(event.content, keys.sk, keys.pk);
    const parsed = JSON.parse(plaintext);
    const entries: Array<[string, string]> = Array.isArray(parsed)
      ? parsed.filter(
          (item) => Array.isArray(item) && item.length >= 2 && typeof item[0] === "string" && typeof item[1] === "string",
        )
      : [];
    const mintsFromContent = entries.filter((entry) => entry[0] === "mint").map((entry) => entry[1]);
    const priv = entries.find((entry) => entry[0] === "privkey")?.[1];
    const mintsFromTags = Array.isArray(event.tags)
      ? event.tags.filter((tag) => Array.isArray(tag) && tag[0] === "mint" && typeof tag[1] === "string").map((tag) => tag[1])
      : [];
    const mints = Array.from(
      new Set([...mintsFromContent, ...mintsFromTags].map((mint) => normalizeMintUrl(mint)).filter(Boolean)),
    );
    return {
      id: event.id,
      created_at: event.created_at,
      mints,
      walletPrivkey: priv || null,
    };
  } catch {
    return null;
  }
}

export async function parseTokenEvent(
  event: { id?: string; content?: string; created_at?: number },
  keys: { sk: string; pk: string },
): Promise<ParsedTokenEvent | null> {
  if (!event?.id || !event.content) return null;
  try {
    const plaintext = await decryptForSelf(event.content, keys.sk, keys.pk);
    const parsed = JSON.parse(plaintext);
    if (!parsed || typeof parsed !== "object") return null;
    const mint = normalizeMintUrl((parsed as any).mint || "");
    if (!mint) return null;
    const proofs = Array.isArray((parsed as any).proofs) ? ((parsed as any).proofs as Proof[]) : [];
    const unit = typeof (parsed as any).unit === "string" ? (parsed as any).unit : undefined;
    const del = Array.isArray((parsed as any).del)
      ? ((parsed as any).del as unknown[]).filter((id): id is string => typeof id === "string" && id.trim())
      : undefined;
    return {
      id: event.id,
      created_at: event.created_at,
      mint,
      proofs,
      unit,
      del,
    };
  } catch {
    return null;
  }
}

export function hashHistoryPayload(payload: ParsedHistoryEvent): string {
  const normalized = {
    entryId: payload.entryId || "",
    direction: payload.direction || "",
    amount: payload.amount || 0,
    unit: payload.unit || "",
    summary: payload.summary || "",
    mint: payload.mint || "",
    feeSat: payload.feeSat || 0,
    detail: payload.detail || "",
    detailKind: payload.detailKind || "",
    fiatValueUsd: payload.fiatValueUsd || 0,
    stateLabel: payload.stateLabel || "",
    relatedTaskTitle: payload.relatedTaskTitle || "",
  };
  const raw = JSON.stringify(normalized);
  return bytesToHex(sha256(new TextEncoder().encode(raw)));
}

export async function createHistoryEventTemplate(
  entry: ParsedHistoryEvent,
  keys: { sk: string; pk: string },
  options?: { createdAt?: number; eTags?: string[][] },
): Promise<EventTemplate> {
  const created_at = options?.createdAt ?? Math.floor(Date.now() / 1000);
  const payload = {
    direction: entry.direction || "",
    amount: entry.amount ?? 0,
    unit: entry.unit || "sat",
    summary: entry.summary || "",
    mint: entry.mint || "",
    feeSat: entry.feeSat ?? undefined,
    entryId: entry.entryId || "",
    detail: entry.detail || "",
    detailKind: entry.detailKind || "",
    revertToken: entry.revertToken || "",
    fiatValueUsd: entry.fiatValueUsd ?? undefined,
    stateLabel: entry.stateLabel || "",
    pendingTokenId: entry.pendingTokenId || "",
    pendingTokenAmount: entry.pendingTokenAmount ?? undefined,
    pendingTokenMint: entry.pendingTokenMint || "",
    pendingStatus: entry.pendingStatus || "",
    relatedTaskTitle: entry.relatedTaskTitle || "",
  };
  const content = await encryptForSelf(payload, keys.sk, keys.pk);
  const tags: string[][] = [];
  if (entry.entryId) {
    tags.push(["d", entry.entryId]);
  }
  if (entry.mint) {
    tags.push(["mint", entry.mint]);
  }
  if (Array.isArray(options?.eTags)) {
    for (const tag of options.eTags) {
      if (Array.isArray(tag) && tag.length >= 2) {
        tags.push(tag);
      }
    }
  }
  return {
    kind: NIP60_HISTORY_KIND,
    content,
    tags,
    created_at,
  };
}

export async function parseHistoryEvent(
  event: { id?: string; content?: string; created_at?: number; tags?: string[][] },
  keys: { sk: string; pk: string },
): Promise<ParsedHistoryEvent | null> {
  if (!event?.id || !event.content) return null;
  try {
    const plaintext = await decryptForSelf(event.content, keys.sk, keys.pk);
    const parsed = JSON.parse(plaintext);
    if (!parsed || typeof parsed !== "object") return null;
    const entryId =
      Array.isArray(event.tags) && event.tags.find((tag) => Array.isArray(tag) && tag[0] === "d")?.[1];
    const mint =
      Array.isArray(event.tags) && event.tags.find((tag) => Array.isArray(tag) && tag[0] === "mint")?.[1];
    return {
      id: event.id,
      created_at: event.created_at,
      entryId: entryId || (parsed as any).entryId || undefined,
      direction: typeof (parsed as any).direction === "string" ? (parsed as any).direction : undefined,
      amount: typeof (parsed as any).amount === "number" ? (parsed as any).amount : Number((parsed as any).amount) || 0,
      unit: typeof (parsed as any).unit === "string" ? (parsed as any).unit : undefined,
      summary: typeof (parsed as any).summary === "string" ? (parsed as any).summary : undefined,
      mint: typeof mint === "string" ? mint : typeof (parsed as any).mint === "string" ? (parsed as any).mint : undefined,
      feeSat:
        typeof (parsed as any).feeSat === "number"
          ? (parsed as any).feeSat
          : Number((parsed as any).feeSat) || undefined,
      detail: typeof (parsed as any).detail === "string" ? (parsed as any).detail : undefined,
      detailKind: typeof (parsed as any).detailKind === "string" ? (parsed as any).detailKind : undefined,
      fiatValueUsd:
        typeof (parsed as any).fiatValueUsd === "number"
          ? (parsed as any).fiatValueUsd
          : Number((parsed as any).fiatValueUsd) || undefined,
      stateLabel: typeof (parsed as any).stateLabel === "string" ? (parsed as any).stateLabel : undefined,
      relatedTaskTitle:
        typeof (parsed as any).relatedTaskTitle === "string" ? (parsed as any).relatedTaskTitle : undefined,
    };
  } catch {
    return null;
  }
}

export function extractDeletedIds(events: NostrEvent[]): Set<string> {
  const deleted = new Set<string>();
  for (const ev of events) {
    if (!ev || ev.kind !== 5 || !Array.isArray(ev.tags)) continue;
    const targetsTokens = ev.tags.some((tag) => Array.isArray(tag) && tag[0] === "k" && String(tag[1]) === String(NIP60_TOKEN_KIND));
    if (!targetsTokens) continue;
    for (const tag of ev.tags) {
      if (!Array.isArray(tag) || tag.length < 2) continue;
      if (tag[0] === "e" && typeof tag[1] === "string" && tag[1].trim()) {
        deleted.add(tag[1].trim());
      }
    }
  }
  return deleted;
}

export function selectLatestTokenEvents(
  events: ParsedTokenEvent[],
  deletedIds: Set<string>,
): Map<string, ParsedTokenEvent> {
  const tombstones = new Set<string>(deletedIds);
  for (const ev of events) {
    if (Array.isArray(ev.del)) {
      ev.del.forEach((id) => {
        if (id) tombstones.add(id);
      });
    }
  }

  const grouped = new Map<string, ParsedTokenEvent>();
  for (const ev of events) {
    if (!ev || !ev.id) continue;
    if (tombstones.has(ev.id)) continue;
    const mint = normalizeMintUrl(ev.mint);
    if (!mint) continue;
    const existing = grouped.get(mint);
    if (!existing || (ev.created_at || 0) > (existing.created_at || 0)) {
      grouped.set(mint, { ...ev, mint });
    }
  }
  return grouped;
}

export function selectLatestHistoryEvents(events: ParsedHistoryEvent[]): Map<string, ParsedHistoryEvent> {
  const grouped = new Map<string, ParsedHistoryEvent>();
  for (const ev of events) {
    if (!ev || !ev.id) continue;
    const key = ev.entryId || ev.id;
    const existing = grouped.get(key);
    if (!existing || (ev.created_at || 0) > (existing.created_at || 0)) {
      grouped.set(key, ev);
    }
  }
  return grouped;
}

export function getNostrPubkeyFromSecret(sk: string): string | null {
  try {
    const pk = getPublicKey(hexToBytes(sk));
    return typeof pk === "string" ? pk : null;
  } catch {
    return null;
  }
}
