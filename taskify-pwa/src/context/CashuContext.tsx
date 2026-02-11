import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { MeltProofsResponse, MeltQuoteResponse, MintQuoteResponse, Proof, ProofState } from "@cashu/cashu-ts";
import { getDecodedToken, getEncodedToken } from "@cashu/cashu-ts";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { finalizeEvent, getPublicKey, type Event as NostrEvent, type EventTemplate } from "nostr-tools";
import { MintSession, type MintConnection, type CreateSendTokenOptions, type SendTokenLockInfo } from "../mint/MintSession";
import {
  addPendingToken,
  addMintToList,
  getActiveMint,
  getMintList,
  listPendingTokens,
  loadStore,
  markPendingTokenAttempt,
  removePendingToken,
  setPendingTokenSource,
  setActiveMint as persistActiveMint,
  setProofs as persistProofsForMint,
  replaceMintList,
  type PendingTokenEntry,
} from "../wallet/storage";
import { LS_NOSTR_SK } from "../nostrKeys";
import { useP2PK } from "./P2PKContext";
import { normalizeNostrPubkey, deriveCompressedPubkeyFromSecret } from "../lib/nostr";
import { decodeBolt11Amount } from "../wallet/lightning";
import {
  createHistoryEventTemplate,
  createTokenEventTemplate,
  createWalletEventTemplate,
  deriveWalletPrivkey,
  extractDeletedIds,
  hashHistoryPayload,
  hashMints,
  hashProofs,
  NIP60_HISTORY_KIND,
  NIP60_TOKEN_KIND,
  NIP60_WALLET_KIND,
  loadDefaultNostrRelays,
  loadNip60Queue,
  loadNip60SyncState,
  parseHistoryEvent,
  parseTokenEvent,
  parseWalletEvent,
  persistNip60Queue,
  persistNip60SyncState,
  selectLatestHistoryEvents,
  selectLatestTokenEvents,
  type Nip60QueuedEvent,
  type Nip60WalletSnapshot,
  type Nip60SyncState,
  type ParsedHistoryEvent,
} from "../wallet/nip60";
import { getWalletSeedBytes } from "../wallet/seed";
import { NostrSession } from "../nostr/NostrSession";
import { createNutzapInfoEventTemplate, NIP61_NUTZAP_KIND, parseNutzapEvent } from "../wallet/nip61";
import { proofIsLockedToPubkey } from "../wallet/p2pk";
import { kvStorage } from "../storage/kvStorage";
import { idbKeyValue } from "../storage/idbKeyValue";
import { TASKIFY_STORE_WALLET } from "../storage/taskifyDb";

type MintInfo = {
  name?: string;
  unit?: string;
  version?: string;
};

type ReceiveTokenResult = {
  proofs: Proof[];
  usedMintUrl: string;
  activeMintUrl: string;
  crossMint: boolean;
  savedForLater: boolean;
  pendingTokenId?: string;
  pendingTokenAmount?: number;
};

type SavePendingTokenResult = {
  id: string;
  amountSat?: number;
  mintUrl: string;
  crossMint: boolean;
};

type BalanceSnapshot = {
  total: number;
  pending: number;
};

type CashuContextType = {
  ready: boolean;
  mintUrl: string;
  setMintUrl: (url: string) => Promise<void>;
  balance: number;
  totalBalance: number;
  pendingBalance: number;
  proofs: Proof[];
  info: MintInfo | null;
  createMintInvoice: (
    amount: number,
    description?: string,
    options?: { mintUrl?: string },
  ) => Promise<{
    request: string;
    quote: string;
    expiry: number;
    amount?: number;
    unit?: string;
    mintUrl: string;
  }>;
  checkMintQuote: (
    quoteId: string,
    options?: { mintUrl?: string },
  ) => Promise<"UNPAID" | "PAID" | "ISSUED">;
  claimMint: (
    quoteId: string,
    amount: number,
    options?: { mintUrl?: string },
  ) => Promise<Proof[]>;
  savePendingTokenForRedemption: (encoded: string) => Promise<SavePendingTokenResult>;
  receiveToken: (encoded: string) => Promise<ReceiveTokenResult>;
  createSendToken: (
    amount: number,
    options?: CreateSendTokenOptions & { mintUrl?: string },
  ) => Promise<{ token: string; proofs: Proof[]; mintUrl: string; lockInfo?: SendTokenLockInfo }>;
  payInvoice: (
    invoice: string,
    options?: { mintUrl?: string },
  ) => Promise<{ state: string; amountSat?: number | null; feeReserveSat?: number | null; mintUrl?: string }>;
  checkProofStates: (mintUrl: string, proofs: Proof[]) => Promise<ProofState[]>;
  subscribeProofStateUpdates: (
    mintUrl: string,
    proofs: Proof[],
    callback: (payload: ProofState & { proof: Proof }) => void,
    onError: (e: Error) => void,
  ) => Promise<() => void>;
  subscribeMintQuoteUpdates: (
    mintUrl: string,
    quoteIds: string[],
    callback: (quote: MintQuoteResponse) => void,
    onError: (e: Error) => void,
  ) => Promise<() => void>;
  createTokenFromProofSelection: (
    secrets: string[],
  ) => Promise<{ token: string; proofs: Proof[]; mintUrl: string }>;
  redeemPendingToken: (id: string) => Promise<{ proofs: Proof[]; mintUrl: string }>;
  walletSyncEnabled: boolean;
  setWalletSyncEnabled: (enabled: boolean) => void;
};

const globalCtxKey = "__TASKIFY_CASHU_CONTEXT__";
const globalObj: any = typeof globalThis !== "undefined" ? (globalThis as any) : {};
const CashuContext: React.Context<CashuContextType | null> =
  globalObj[globalCtxKey] ?? (globalObj[globalCtxKey] = createContext<CashuContextType | null>(null));

function isLikelyOfflineError(error: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return true;
  }
  if (!error) return false;
  const message = typeof error === "string"
    ? error.toLowerCase()
    : typeof (error as any)?.message === "string"
      ? (error as any).message.toLowerCase()
      : "";
  if (!message) return false;
  return (
    message.includes("network") ||
    message.includes("fetch") ||
    message.includes("load failed") ||
    message.includes("offline") ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("connection")
  );
}

function deriveTokenAmount(token: string): number {
  try {
    const decoded: any = getDecodedToken(token);
    if (!decoded) return 0;
    const entries: any[] = Array.isArray(decoded?.token)
      ? decoded.token
      : decoded?.proofs
        ? [decoded]
        : [];
    if (!entries.length) return 0;
    return entries.reduce((outerTotal, entry) => {
      const proofs = Array.isArray(entry?.proofs) ? entry.proofs : [];
      return (
        outerTotal +
        proofs.reduce((sum, proof) => {
          const amt = typeof proof?.amount === "number" ? proof.amount : 0;
          return sum + (Number.isFinite(amt) ? amt : 0);
        }, 0)
      );
    }, 0);
  } catch {
    return 0;
  }
}

function isTokenAlreadySpentError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as any)?.code;
  if (typeof code === "number" && code === 11001) return true;
  if (typeof code === "string" && Number.parseInt(code, 10) === 11001) return true;

  const detail = typeof (err as any)?.detail === "string" ? (err as any).detail.toLowerCase() : "";
  if (detail.includes("already spent")) return true;

  const message = typeof (err as any)?.message === "string" ? (err as any).message.toLowerCase() : "";
  if (message.includes("already spent")) return true;

  const responseData =
    typeof (err as any)?.response === "object" && (err as any).response !== null
      ? ((err as any).response as Record<string, unknown>).data
      : null;
  if (responseData && typeof responseData === "object") {
    const dataCode = (responseData as any)?.code;
    if (typeof dataCode === "number" && dataCode === 11001) return true;
    if (typeof dataCode === "string" && Number.parseInt(dataCode, 10) === 11001) return true;
    const dataDetail = typeof (responseData as any)?.detail === "string" ? (responseData as any).detail.toLowerCase() : "";
    if (dataDetail.includes("already spent")) return true;
  }

  return false;
}

function normalizeMintUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function extractProofsForMint(token: string, mintUrl: string): Proof[] {
  const normalizedMint = normalizeMintUrl(mintUrl);
  if (!normalizedMint) return [];
  try {
    const decoded: any = getDecodedToken(token);
    const entries: any[] = decoded
      ? Array.isArray(decoded?.token)
        ? decoded.token
        : decoded?.proofs
          ? [decoded]
          : []
      : [];
    return entries
      .filter((item) => normalizeMintUrl(item?.mint ?? "") === normalizedMint)
      .flatMap((item) => (Array.isArray(item?.proofs) ? item.proofs : []))
      .filter((proof): proof is Proof => !!proof && typeof proof === "object");
  } catch {
    return [];
  }
}

type NostrKeypair = { sk: string; pk: string };

type LocalHistoryEntry = {
  id?: string;
  summary?: string;
  type?: string;
  direction?: string;
  amountSat?: number;
  detailKind?: string;
  detail?: string;
  mintUrl?: string;
  feeSat?: number;
  entryKind?: string;
  relatedTaskTitle?: string;
  createdAt?: number;
  revertToken?: string;
  fiatValueUsd?: number;
  stateLabel?: string;
  pendingTokenId?: string;
  pendingTokenAmount?: number;
  pendingTokenMint?: string;
  pendingStatus?: "pending" | "redeemed";
  nutzapEventId?: string;
  nutzapRelay?: string;
  nutzapSenderPubkey?: string;
  tokenState?: unknown;
  mintQuote?: unknown;
};

const LS_WALLET_HISTORY = "cashuHistory";
const LS_SETTINGS = "taskify_settings_v2";
const HISTORY_SYNC_LIMIT = 200;
const LS_NIP61_PROCESSED = "cashu_nip61_processed_v1";
const LS_NIP61_SINCE = "cashu_nip61_since_v1";

function loadStoredStringSet(key: string): Set<string> {
  try {
    const raw = idbKeyValue.getItem(TASKIFY_STORE_WALLET, key);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    const values = parsed.filter((id): id is string => typeof id === "string" && id.trim()).map((id) => id.trim());
    return new Set(values);
  } catch {
    return new Set();
  }
}

function persistStoredStringSet(key: string, set: Set<string>, limit = 500) {
  try {
    const arr = Array.from(set).slice(-Math.max(1, limit));
    idbKeyValue.setItem(TASKIFY_STORE_WALLET, key, JSON.stringify(arr));
  } catch {
    // ignore
  }
}

function loadStoredSince(key: string): number {
  try {
    const raw = idbKeyValue.getItem(TASKIFY_STORE_WALLET, key);
    const num = Number(raw);
    return Number.isFinite(num) && num > 0 ? Math.floor(num) : 0;
  } catch {
    return 0;
  }
}

function persistStoredSince(key: string, since: number) {
  try {
    const normalized = Number.isFinite(since) && since > 0 ? Math.floor(since) : 0;
    idbKeyValue.setItem(TASKIFY_STORE_WALLET, key, String(normalized));
  } catch {
    // ignore
  }
}

function loadNostrKeysFromStorage(): NostrKeypair | null {
  try {
    const raw = kvStorage.getItem(LS_NOSTR_SK) || "";
    const trimmed = raw.trim();
    if (!/^[0-9a-fA-F]{64}$/.test(trimmed)) return null;
    const pk = getPublicKey(hexToBytes(trimmed));
    if (typeof pk === "string" && pk) {
      return { sk: trimmed.toLowerCase(), pk };
    }
    if (pk && typeof pk === "object" && "length" in pk) {
      return { sk: trimmed.toLowerCase(), pk: bytesToHex(pk as ArrayLike<number>) };
    }
    return null;
  } catch {
    return null;
  }
}

function readLocalHistory(): LocalHistoryEntry[] {
  try {
    const raw = idbKeyValue.getItem(TASKIFY_STORE_WALLET, LS_WALLET_HISTORY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as LocalHistoryEntry[];
  } catch {
    return [];
  }
}

function persistLocalHistory(entries: LocalHistoryEntry[]) {
  try {
    idbKeyValue.setItem(TASKIFY_STORE_WALLET, LS_WALLET_HISTORY, JSON.stringify(entries));
  } catch {
    // ignore persistence failures
  }
}

export function CashuProvider({ children }: { children: React.ReactNode }) {
  const [mintUrl, setMintUrlState] = useState<string>(() => getActiveMint());
  const [manager, setManager] = useState<MintConnection | null>(null);
  const [ready, setReady] = useState(false);
  const [balance, setBalance] = useState(0);
  const [balanceSnapshot, setBalanceSnapshot] = useState<BalanceSnapshot>(() => calculateBalances());
  const totalBalance = balanceSnapshot.total;
  const pendingBalance = balanceSnapshot.pending;
  const [proofs, setProofs] = useState<Proof[]>([]);
  const [info, setInfo] = useState<MintInfo | null>(null);
  const initialNip60State = loadNip60SyncState();
  if (!initialNip60State.tokens) initialNip60State.tokens = {};
  if (!initialNip60State.history) initialNip60State.history = {};
  const nip60StateRef = useRef<Nip60SyncState>(initialNip60State);
  const nip60QueueRef = useRef<Nip60QueuedEvent[]>(loadNip60Queue());
  const nip60SyncInFlightRef = useRef(false);
  const nip60SyncPendingRef = useRef(false);
  const [nip60SyncNonce, setNip60SyncNonce] = useState(0);
  const [walletSyncEnabled, setWalletSyncEnabledState] = useState<boolean>(() => {
    try {
      const parsed = JSON.parse(kvStorage.getItem(LS_SETTINGS) || "{}");
      return parsed?.walletNostrSyncEnabled !== false;
    } catch {
      return true;
    }
  });
  const walletSyncEnabledRef = useRef(walletSyncEnabled);
  const setWalletSyncEnabled = useCallback((enabled: boolean) => {
    const next = enabled !== false;
    walletSyncEnabledRef.current = next;
    setWalletSyncEnabledState(next);
  }, []);
  const derivedWalletPrivkeyRef = useRef<string>(deriveWalletPrivkey(getWalletSeedBytes()));
  const syncedWalletPrivkeyRef = useRef<string | null>(nip60StateRef.current.wallet?.privkey ?? null);
  const nostrKeysCacheRef = useRef<NostrKeypair | null>(null);
  const redeemingPendingRef = useRef(false);
  const nip61ProcessedRef = useRef<Set<string>>(loadStoredStringSet(LS_NIP61_PROCESSED));
  const nip61SinceRef = useRef<number>(loadStoredSince(LS_NIP61_SINCE));
  const nip61SubscriptionReleaseRef = useRef<(() => void) | null>(null);
  const nip61InFlightRef = useRef<Set<string>>(new Set());
  const mintBootPromisesRef = useRef<
    Map<
      string | null,
      Promise<{
        manager: MintConnection | null;
        balance: number;
        proofs: Proof[];
        info: MintInfo | null;
      }>
    >
  >(new Map());
  const { getPrivateKeyForPubkey: getStoredP2PKPrivkey, markKeyUsed, primaryKey } = useP2PK();

  function calculateBalances(): BalanceSnapshot {
    try {
      const store = loadStore();
      const base = Object.values(store).reduce((outerTotal, proofsForMint) => {
        if (!Array.isArray(proofsForMint)) return outerTotal;
        const mintProofs = proofsForMint as Proof[];
        const mintSum = mintProofs.reduce((sum, proof) => sum + (proof?.amount || 0), 0);
        return outerTotal + mintSum;
      }, 0);
      let pendingSum = 0;
      try {
        const pendingEntries = listPendingTokens();
        pendingSum = pendingEntries.reduce((sum, entry) => {
          if (typeof entry.amount === "number" && Number.isFinite(entry.amount)) {
            return sum + entry.amount;
          }
          return sum + deriveTokenAmount(entry.token);
        }, 0);
      } catch {
        pendingSum = 0;
      }
      return { total: base + pendingSum, pending: pendingSum };
    } catch {
      return { total: 0, pending: 0 };
    }
  }

  const syncActiveMintFromStorage = useCallback(() => {
    try {
      const persisted = getActiveMint();
      setMintUrlState((prev) => (prev === persisted ? prev : persisted));
    } catch {
      // ignore storage access issues
    }
  }, []);

  const getLocalP2PKPrivkey = useCallback(
    (pubkey: string) => {
      const normalizedTarget = normalizeNostrPubkey(pubkey);
      if (!normalizedTarget) return null;
      const stored = getStoredP2PKPrivkey(normalizedTarget);
      if (stored) return stored;
      const walletPrivCandidates = [
        primaryKey?.privateKey,
        syncedWalletPrivkeyRef.current ?? undefined,
        derivedWalletPrivkeyRef.current,
      ].filter(Boolean) as string[];
      for (const candidate of walletPrivCandidates) {
        const derived = deriveCompressedPubkeyFromSecret(candidate);
        if (derived && derived === normalizedTarget) {
          return candidate.toLowerCase();
        }
      }
      try {
        const raw = kvStorage.getItem(LS_NOSTR_SK) || "";
        const trimmed = raw.trim();
        if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
          const derived = deriveCompressedPubkeyFromSecret(trimmed);
          if (derived && derived === normalizedTarget) {
            return trimmed.toLowerCase();
          }
        }
      } catch {
        // ignore
      }
      return null;
    },
    [getStoredP2PKPrivkey, primaryKey],
  );

  const refreshTotalBalance = useCallback(() => {
    setBalanceSnapshot(calculateBalances());
    syncActiveMintFromStorage();
  }, [syncActiveMintFromStorage]);

  const loadNostrKeys = useCallback(() => {
    const keys = loadNostrKeysFromStorage();
    nostrKeysCacheRef.current = keys;
    return keys;
  }, []);

  const updateNip60Queue = useCallback((queue: Nip60QueuedEvent[]) => {
    nip60QueueRef.current = queue;
    persistNip60Queue(queue);
  }, []);

  const updateNip60State = useCallback((state: Nip60SyncState) => {
    nip60StateRef.current = state;
    persistNip60SyncState(state);
  }, []);

  const requestNip60Sync = useCallback(() => {
    if (!walletSyncEnabledRef.current) return;
    setNip60SyncNonce((value) => value + 1);
  }, []);

  const getWalletPrivkeyForSync = useCallback(() => {
    if (primaryKey?.privateKey) return primaryKey.privateKey;
    if (syncedWalletPrivkeyRef.current) return syncedWalletPrivkeyRef.current;
    return derivedWalletPrivkeyRef.current;
  }, [primaryKey]);

  const removeQueuedTokenEvents = useCallback(
    (mintUrl: string) => {
      const normalized = normalizeMintUrl(mintUrl);
      if (!normalized) return;
      const filtered = nip60QueueRef.current.filter(
        (entry) =>
          !(
            (entry.type === "token" || entry.type === "delete") &&
            normalizeMintUrl(entry.mint || "") === normalized
          ),
      );
      if (filtered.length !== nip60QueueRef.current.length) {
        updateNip60Queue(filtered);
      }
    },
    [updateNip60Queue],
  );

  const enqueueNip60Event = useCallback(
    (entry: Nip60QueuedEvent) => {
      const filtered = nip60QueueRef.current.filter((existing) => {
        if (existing.id === entry.id) return false;
        if (entry.type === "token" && existing.type === "token") {
          return normalizeMintUrl(existing.mint || "") !== normalizeMintUrl(entry.mint || "");
        }
        if (entry.type === "wallet" && existing.type === "wallet") {
          return false;
        }
        if (entry.type === "history" && existing.type === "history" && entry.hash && existing.hash) {
          return entry.hash !== existing.hash;
        }
        return true;
      });
      filtered.push(entry);
      updateNip60Queue(filtered);
    },
    [updateNip60Queue],
  );

  const handleRemoteWalletEvent = useCallback(
    (event: ParsedWalletEvent | null) => {
      if (!event) return;
      const current = nip60StateRef.current;
      const existingCreated = current.wallet?.created_at || 0;
      const incomingCreated = event.created_at || 0;
      const incomingPrivkey = event.walletPrivkey || current.wallet?.privkey || null;
      const incomingHash = hashMints(event.mints, incomingPrivkey);
      const existingHash = current.wallet?.hash || "";
      const shouldApply =
        !current.wallet ||
        incomingCreated > existingCreated ||
        (incomingCreated === existingCreated && incomingHash !== existingHash);
      if (!shouldApply) return;
      const nextWallet: Nip60WalletSnapshot = {
        id: event.id,
        created_at: incomingCreated || Math.floor(Date.now() / 1000),
        hash: incomingHash,
        privkey: incomingPrivkey || undefined,
      };
      syncedWalletPrivkeyRef.current = incomingPrivkey || syncedWalletPrivkeyRef.current;
      replaceMintList(event.mints);
      updateNip60State({ ...current, wallet: nextWallet });
    },
    [updateNip60State],
  );

  const applyRemoteTokenEvents = useCallback(
    (eventsByMint: Map<string, ParsedTokenEvent>, deletedIds: Set<string>) => {
      if (!eventsByMint.size && !deletedIds.size) return;
      const current = nip60StateRef.current;
      const queueByMint = new Map<string, Nip60QueuedEvent>();
      for (const entry of nip60QueueRef.current) {
        if (entry.type === "token" && entry.mint) {
          queueByMint.set(normalizeMintUrl(entry.mint), entry);
        }
      }
      const activeNormalized = normalizeMintUrl(manager?.mintUrl || "");
      let changed = false;

      eventsByMint.forEach((ev, mintKey) => {
        const normalizedMint = normalizeMintUrl(mintKey);
        const proofHash = hashProofs(ev.proofs);
        const queued = queueByMint.get(normalizedMint);
        if (queued && queued.hash === proofHash) return;
        const existing = current.tokens[normalizedMint];
        const createdAt = ev.created_at || 0;
        if (existing && existing.hash === proofHash && (existing.created_at || 0) >= createdAt) {
          return;
        }
        if (existing && (existing.created_at || 0) > createdAt && existing.hash !== proofHash) {
          // Local snapshot is newer; keep it.
          return;
        }
        persistProofsForMint(normalizedMint, ev.proofs);
        if (manager && normalizedMint === activeNormalized) {
          manager.replaceProofsFromSync(ev.proofs);
          setBalance(manager.balance);
          setProofs(manager.proofs);
        }
        current.tokens[normalizedMint] = {
          id: ev.id,
          created_at: createdAt || Math.floor(Date.now() / 1000),
          hash: proofHash,
        };
        changed = true;
      });

      Object.entries(current.tokens).forEach(([mintKey, snapshot]) => {
        if (deletedIds.has(snapshot.id) && !eventsByMint.has(mintKey)) {
          persistProofsForMint(mintKey, []);
          if (manager && normalizeMintUrl(manager.mintUrl) === normalizeMintUrl(mintKey)) {
            manager.replaceProofsFromSync([]);
            setBalance(manager.balance);
            setProofs(manager.proofs);
          }
          delete current.tokens[mintKey];
          changed = true;
        }
      });

      if (changed) {
        updateNip60State({ ...current, tokens: { ...current.tokens } });
        refreshTotalBalance();
      }
    },
    [manager, refreshTotalBalance, setBalance, setProofs, updateNip60State],
  );

  const applyRemoteHistoryEvents = useCallback(
    (eventsByEntry: Map<string, ParsedHistoryEvent>) => {
      if (!eventsByEntry.size) return;
      const current = nip60StateRef.current;
      if (!current.history) current.history = {};
      const local = readLocalHistory();
      const byId = new Map<string, LocalHistoryEntry>();
      local.forEach((entry) => {
        const key = entry?.id || "";
        if (key) byId.set(key, entry);
      });
      let changed = false;
      eventsByEntry.forEach((ev, key) => {
        const hash = hashHistoryPayload(ev);
        const snap = current.history[key];
        if (snap && snap.hash === hash) return;
        const createdAtMs =
          (typeof ev.created_at === "number" && Number.isFinite(ev.created_at) ? ev.created_at * 1000 : Date.now());
        const entry: LocalHistoryEntry = {
          id: key,
          summary: ev.summary || "Wallet activity",
          direction: ev.direction,
          amountSat: ev.amount ?? 0,
          mintUrl: ev.mint,
          feeSat: ev.feeSat,
          detail: ev.detail,
          detailKind: ev.detailKind,
          fiatValueUsd: ev.fiatValueUsd,
          stateLabel: ev.stateLabel,
          relatedTaskTitle: ev.relatedTaskTitle,
          createdAt: createdAtMs,
          entryKind: "nostr-sync",
        };
        // Preserve local-only fields if we already have them.
        const existingLocal = byId.get(key);
        if (existingLocal) {
          entry.revertToken = existingLocal.revertToken;
          entry.pendingTokenId = existingLocal.pendingTokenId;
          entry.pendingTokenAmount = existingLocal.pendingTokenAmount;
          entry.pendingTokenMint = existingLocal.pendingTokenMint;
          entry.pendingStatus = existingLocal.pendingStatus;
          entry.nutzapEventId = existingLocal.nutzapEventId;
          entry.nutzapRelay = existingLocal.nutzapRelay;
          entry.nutzapSenderPubkey = existingLocal.nutzapSenderPubkey;
          entry.tokenState = existingLocal.tokenState;
          entry.mintQuote = existingLocal.mintQuote;
        }
        if (!byId.has(key)) {
          local.unshift(entry);
          byId.set(key, entry);
        } else {
          byId.set(key, { ...byId.get(key), ...entry });
        }
        current.history[key] = {
          id: ev.id,
          created_at: ev.created_at || Math.floor(createdAtMs / 1000),
          hash,
          entryId: ev.entryId,
        };
        changed = true;
      });
      if (changed) {
        persistLocalHistory(local.slice(0, HISTORY_SYNC_LIMIT));
        updateNip60State({ ...current, history: { ...current.history } });
      }
    },
    [updateNip60State],
  );

  const flushNip60Queue = useCallback(
    async (relayUrls: string[]) => {
      if (!nip60QueueRef.current.length) return;
      const session = await NostrSession.init(relayUrls);
      const remaining: Nip60QueuedEvent[] = [];
      for (const entry of nip60QueueRef.current) {
        try {
          await session.publishRaw(entry.event as NostrEvent, { relayUrls, returnEvent: false });
        } catch (error) {
          remaining.push(entry);
          if (isLikelyOfflineError(error)) {
            break;
          }
        }
      }
      updateNip60Queue(remaining);
    },
    [updateNip60Queue],
  );

  const publishNip60State = useCallback(
    async (keys: NostrKeypair, relays: string[]) => {
      const nextState: Nip60SyncState = {
        ...nip60StateRef.current,
        tokens: { ...nip60StateRef.current.tokens },
        history: { ...(nip60StateRef.current.history || {}) },
      };

      const session = await NostrSession.init(relays);
      const signAndPublish = async (
        template: EventTemplate,
        queueMeta: Omit<Nip60QueuedEvent, "id" | "created_at" | "event">,
      ): Promise<{ event: NostrEvent; createdAt: number; published: boolean; error?: unknown }> => {
        const signed = finalizeEvent(template, hexToBytes(keys.sk));
        const createdAt = signed.created_at || template.created_at || Math.floor(Date.now() / 1000);
        const entry: Nip60QueuedEvent = {
          ...queueMeta,
          id: signed.id,
          created_at: createdAt,
          relays,
          event: signed as unknown as NostrEvent,
        };
        try {
          await session.publishRaw(signed as unknown as NostrEvent, { relayUrls: relays, returnEvent: false });
          return { event: signed as unknown as NostrEvent, createdAt, published: true };
        } catch (error) {
          enqueueNip60Event(entry);
          return { event: signed as unknown as NostrEvent, createdAt, published: false, error };
        }
      };

      const walletPrivkey = getWalletPrivkeyForSync();
      const mints = getMintList();
      const walletHash = hashMints(mints, walletPrivkey);
      const queuedWallet = nip60QueueRef.current.find((entry) => entry.type === "wallet");

      if (queuedWallet && queuedWallet.hash && queuedWallet.hash !== walletHash && nextState.wallet?.hash === walletHash) {
        updateNip60Queue(nip60QueueRef.current.filter((entry) => entry.type !== "wallet"));
      }

      if (queuedWallet && queuedWallet.hash === walletHash) {
        nextState.wallet = {
          id: queuedWallet.id,
          created_at: queuedWallet.created_at,
          hash: walletHash,
          privkey: walletPrivkey || undefined,
        };
      } else if (!nextState.wallet || nextState.wallet.hash !== walletHash) {
        if (queuedWallet) {
          updateNip60Queue(nip60QueueRef.current.filter((entry) => entry.type !== "wallet"));
        }
        const createdAt = Math.max(
          Math.floor(Date.now() / 1000),
          (nextState.wallet?.created_at || 0) + 1,
          queuedWallet?.created_at ? queuedWallet.created_at + 1 : 0,
        );
        const template = await createWalletEventTemplate(mints, walletPrivkey, keys, { createdAt });
        const walletResult = await signAndPublish(template, { type: "wallet", hash: walletHash });
        if (!walletResult.published && isLikelyOfflineError(walletResult.error)) {
          nextState.wallet = {
            id: walletResult.event.id,
            created_at: walletResult.createdAt || createdAt,
            hash: walletHash,
            privkey: walletPrivkey || undefined,
          };
          updateNip60State(nextState);
          return;
        }
        nextState.wallet = {
          id: walletResult.event.id,
          created_at: walletResult.createdAt || createdAt,
          hash: walletHash,
          privkey: walletPrivkey || undefined,
        };
      } else if (walletPrivkey && nextState.wallet && nextState.wallet.privkey !== walletPrivkey) {
        nextState.wallet = { ...nextState.wallet, privkey: walletPrivkey };
      }

      if (nextState.wallet?.privkey) {
        syncedWalletPrivkeyRef.current = nextState.wallet.privkey;
      }

      const store = loadStore();
      const queuedByMint = new Map<string, Nip60QueuedEvent>();
      for (const entry of nip60QueueRef.current) {
        if (entry.type === "token" && entry.mint) {
          queuedByMint.set(normalizeMintUrl(entry.mint), entry);
        }
      }
      const queuedHistory = new Map<string, Nip60QueuedEvent>();
      for (const entry of nip60QueueRef.current) {
        if (entry.type === "history" && entry.hash) {
          queuedHistory.set(entry.hash, entry);
        }
      }

      const allMints = new Set<string>([
        ...Object.keys(store).map((mint) => normalizeMintUrl(mint)),
        ...Object.keys(nextState.tokens),
      ]);

      for (const mint of allMints) {
        if (!mint) continue;
        const proofs = Array.isArray((store as any)[mint]) ? ((store as any)[mint] as Proof[]) : [];
        const proofHash = hashProofs(proofs);
        const queued = queuedByMint.get(mint);
        const existing = nextState.tokens[mint];
        const hasProofs = proofs.length > 0;

        if (queued && queued.hash === proofHash) {
          if (!existing) {
            nextState.tokens[mint] = {
              id: queued.id,
              created_at: queued.created_at,
              hash: queued.hash || proofHash,
            };
          }
          continue;
        }

        if (hasProofs && existing && existing.hash === proofHash) {
          continue;
        }

        const previousId = existing?.id;
        const createdAt = Math.max(
          Math.floor(Date.now() / 1000),
          (existing?.created_at || 0) + 1,
          queued?.created_at ? queued.created_at + 1 : 0,
        );

        if (hasProofs) {
          removeQueuedTokenEvents(mint);
          const template = await createTokenEventTemplate(mint, proofs, keys, {
            del: previousId ? [previousId] : undefined,
            createdAt,
          });
          const tokenResult = await signAndPublish(template, { type: "token", mint, hash: proofHash });
          if (!tokenResult.published && isLikelyOfflineError(tokenResult.error)) {
            nextState.tokens[mint] = {
              id: tokenResult.event.id,
              created_at: tokenResult.createdAt || createdAt,
              hash: proofHash,
            };
            updateNip60State(nextState);
            return;
          }
          if (previousId && previousId !== tokenResult.event.id) {
            const deleteTemplate: EventTemplate = {
              kind: 5,
              content: "",
              tags: [
                ["e", previousId, "", "delete"],
                ["k", String(NIP60_TOKEN_KIND)],
              ],
              created_at: createdAt + 1,
            };
            const deleteResult = await signAndPublish(deleteTemplate, { type: "delete", mint });
            if (!deleteResult.published && isLikelyOfflineError(deleteResult.error)) {
              nextState.tokens[mint] = {
                id: tokenResult.event.id,
                created_at: tokenResult.createdAt || createdAt,
                hash: proofHash,
              };
              updateNip60State(nextState);
              return;
            }
          }
          nextState.tokens[mint] = {
            id: tokenResult.event.id,
            created_at: tokenResult.createdAt || createdAt,
            hash: proofHash,
          };
        } else if (existing) {
          removeQueuedTokenEvents(mint);
          const deleteTemplate: EventTemplate = {
            kind: 5,
            content: "",
            tags: [
              ["e", existing.id, "", "delete"],
              ["k", String(NIP60_TOKEN_KIND)],
            ],
            created_at: createdAt,
          };
          const deleteResult = await signAndPublish(deleteTemplate, { type: "delete", mint });
          if (!deleteResult.published && isLikelyOfflineError(deleteResult.error)) {
            delete nextState.tokens[mint];
            updateNip60State(nextState);
            return;
          }
          delete nextState.tokens[mint];
        }
      }

      // publish history entries
      const localHistory = readLocalHistory();
      const limitedHistory = localHistory.slice(0, HISTORY_SYNC_LIMIT);
      const historyQueueSnapshots = new Map<string, Nip60QueuedEvent>();
      nip60QueueRef.current
        .filter((entry) => entry.type === "history" && entry.hash)
        .forEach((entry) => {
          if (entry.hash) historyQueueSnapshots.set(entry.hash, entry);
        });

      for (const entry of limitedHistory) {
        const key = entry.id || "";
        if (!key) continue;
        const payload: ParsedHistoryEvent = {
          id: "",
          entryId: key,
          direction: entry.direction,
          amount: entry.amountSat,
          unit: "sat",
          summary: entry.summary,
          mint: entry.mintUrl,
          feeSat: entry.feeSat,
          detail: entry.detail,
          detailKind: entry.detailKind,
          fiatValueUsd: entry.fiatValueUsd,
          stateLabel: entry.stateLabel,
          relatedTaskTitle: entry.relatedTaskTitle,
        };
        const hash = hashHistoryPayload(payload);
        const queued = historyQueueSnapshots.get(hash) || queuedHistory.get(hash);
        const snap = nextState.history[key];
        const createdAtSec = Math.max(
          Math.floor((entry.createdAt || Date.now()) / 1000),
          snap?.created_at || 0,
          queued?.created_at || 0,
        );
        const eTags: string[][] = [];
        if (entry.mintUrl) {
          const snapForMint = nextState.tokens[normalizeMintUrl(entry.mintUrl)];
          if (snapForMint?.id) {
            eTags.push(["e", snapForMint.id, "", "created"]);
          }
        }
        if (entry.nutzapEventId) {
          eTags.push(["e", entry.nutzapEventId, entry.nutzapRelay || "", "redeemed"]);
        }
        if (entry.nutzapSenderPubkey) {
          eTags.push(["p", entry.nutzapSenderPubkey]);
        }
        if (queued && queued.hash === hash) {
          if (!snap) {
            nextState.history[key] = {
              id: queued.id,
              created_at: queued.created_at,
              hash,
              entryId: key,
            };
          }
          continue;
        }
        if (snap && snap.hash === hash) continue;
        const template = await createHistoryEventTemplate(payload, keys, { createdAt: createdAtSec, eTags });
        const historyResult = await signAndPublish(template, { type: "history", hash, mint: entry.mintUrl });
        if (!historyResult.published && isLikelyOfflineError(historyResult.error)) {
          nextState.history[key] = {
            id: historyResult.event.id,
            created_at: historyResult.createdAt || createdAtSec,
            hash,
            entryId: key,
          };
          updateNip60State(nextState);
          return;
        }
        nextState.history[key] = {
          id: historyResult.event.id,
          created_at: historyResult.createdAt || createdAtSec,
          hash,
          entryId: key,
        };
      }

      try {
        const walletPrivkey = getWalletPrivkeyForSync();
        const p2pkPubkey = walletPrivkey ? deriveCompressedPubkeyFromSecret(walletPrivkey) : null;
        const mints = getMintList();
        if (p2pkPubkey && mints.length) {
          const infoTemplate = createNutzapInfoEventTemplate({
            relays,
            mints,
            p2pkPubkey,
            unit: "sat",
          });
          const signedInfo = finalizeEvent(infoTemplate, hexToBytes(keys.sk));
          await session.publishRaw(signedInfo as unknown as NostrEvent, { relayUrls: relays, returnEvent: false });
        }
      } catch (error) {
        if (!isLikelyOfflineError(error)) {
          console.warn("NIP-61: failed to publish kind:10019", error);
        }
      }

      updateNip60State(nextState);
    },
    [
      enqueueNip60Event,
      getWalletPrivkeyForSync,
      removeQueuedTokenEvents,
      isLikelyOfflineError,
      updateNip60Queue,
      updateNip60State,
    ],
  );

  const runNip60Sync = useCallback(async () => {
    if (nip60SyncInFlightRef.current) return;
    if (!walletSyncEnabledRef.current) return;
    const keys = loadNostrKeys();
    if (!keys) return;
    const relays = loadDefaultNostrRelays().filter(Boolean);
    if (!relays.length) return;
    nip60SyncInFlightRef.current = true;
    try {
      const session = await NostrSession.init(relays);
      await flushNip60Queue(relays);
      let events: NostrEvent[] = [];
      try {
        events = await session.fetchEvents(
          [{ kinds: [NIP60_WALLET_KIND, NIP60_TOKEN_KIND, NIP60_HISTORY_KIND, 5], authors: [keys.pk] }],
          relays,
        );
      } catch (error) {
        if (isLikelyOfflineError(error)) {
          return;
        }
        console.warn("[wallet] Unable to fetch NIP-60 events", error);
      }
      if (events.length) {
        const deduped = new Map<string, NostrEvent>();
        for (const ev of events) {
          if (ev?.id) deduped.set(ev.id, ev);
        }
        const allEvents = [...deduped.values()];
        const walletEvents = allEvents.filter((ev) => ev.kind === NIP60_WALLET_KIND);
        const tokenEvents = allEvents.filter((ev) => ev.kind === NIP60_TOKEN_KIND);
        const historyEvents = allEvents.filter((ev) => ev.kind === NIP60_HISTORY_KIND);
        const deletionEvents = allEvents.filter((ev) => ev.kind === 5);

        if (walletEvents.length) {
          const parsedWallets = await Promise.all(walletEvents.map((ev) => parseWalletEvent(ev, keys)));
          const latestWallet =
            parsedWallets
              .filter((ev): ev is ParsedWalletEvent => !!ev)
              .sort((a, b) => (a.created_at || 0) - (b.created_at || 0))
              .pop() || null;
          if (latestWallet) {
            handleRemoteWalletEvent(latestWallet);
          }
        }

        if (tokenEvents.length || deletionEvents.length) {
          const parsedTokens = (await Promise.all(tokenEvents.map((ev) => parseTokenEvent(ev, keys)))).filter(
            (ev): ev is ParsedTokenEvent => !!ev,
          );
          const deletedIds = extractDeletedIds(deletionEvents as NostrEvent[]);
          const latestTokens = selectLatestTokenEvents(parsedTokens, deletedIds);
          applyRemoteTokenEvents(latestTokens, deletedIds);
        }

        if (historyEvents.length) {
          const parsedHistory = (await Promise.all(historyEvents.map((ev) => parseHistoryEvent(ev, keys)))).filter(
            (ev): ev is ParsedHistoryEvent => !!ev,
          );
          const latestHistory = selectLatestHistoryEvents(parsedHistory);
          applyRemoteHistoryEvents(latestHistory);
        }
      }

      await publishNip60State(keys, relays);
    } finally {
      nip60SyncInFlightRef.current = false;
    }
  }, [
    applyRemoteTokenEvents,
    applyRemoteHistoryEvents,
    flushNip60Queue,
    handleRemoteWalletEvent,
    loadNostrKeys,
    publishNip60State,
  ]);

  const ensureManagerForMint = useCallback(
    async (mintUrl: string) => {
      const session = MintSession.init({
        getP2PKPrivkey: getLocalP2PKPrivkey,
        onP2PKUsage: (pubkey, count) => markKeyUsed(pubkey, count),
      });
      return session.getConnection(mintUrl);
    },
    [getLocalP2PKPrivkey, markKeyUsed],
  );

  const recordNutzapRedemption = useCallback(
    (payload: {
      eventId: string;
      senderPubkey?: string;
      relay?: string;
      mintUrl: string;
      amountSat: number;
    }) => {
      const eventId = payload.eventId.trim();
      if (!eventId) return;
      const amountSat = Number(payload.amountSat) || 0;
      if (!Number.isFinite(amountSat) || amountSat <= 0) return;
      const key = `nutzap-redeem:${eventId}`;
      const local = readLocalHistory();
      if (local.some((entry) => entry?.id === key)) return;
      const nextEntry: LocalHistoryEntry = {
        id: key,
        summary: `Redeemed nutzap • ${amountSat} sats`,
        type: "ecash",
        direction: "in",
        amountSat,
        mintUrl: payload.mintUrl,
        createdAt: Date.now(),
        entryKind: "nutzap",
        nutzapEventId: eventId,
        nutzapRelay: payload.relay || "",
        nutzapSenderPubkey: payload.senderPubkey,
      };
      local.unshift(nextEntry);
      persistLocalHistory(local.slice(0, HISTORY_SYNC_LIMIT));
      try {
        window.dispatchEvent(new Event("taskify:wallet-history-updated"));
      } catch {
        // ignore
      }
      requestNip60Sync();
    },
    [requestNip60Sync],
  );

  const processPendingEntry = useCallback(
    async (entry: PendingTokenEntry) => {
      const normalizedEntryMint = entry.mint.replace(/\/$/, "");
      const activeMint = manager ? manager.mintUrl.replace(/\/$/, "") : null;
      const targetManager =
        manager && activeMint === normalizedEntryMint ? manager : await ensureManagerForMint(entry.mint);
      const tokenProofs = extractProofsForMint(entry.token, targetManager.mintUrl);
      const existingSecrets = new Set(
        targetManager.proofs
          .map((proof) => (typeof proof?.secret === "string" ? proof.secret : ""))
          .filter(Boolean),
      );
      const freshProofs = tokenProofs.filter(
        (proof) => typeof proof?.secret === "string" && !existingSecrets.has(proof.secret),
      );
      let tokenToRedeem = entry.token;
      if (freshProofs.length && freshProofs.length < tokenProofs.length) {
        tokenToRedeem = getEncodedToken({
          mint: targetManager.mintUrl,
          proofs: freshProofs,
          unit: targetManager.unit,
        });
      }
      if (tokenProofs.length && freshProofs.length === 0) {
        if (entry.source?.type === "nutzap") {
          const amountSat = tokenProofs.reduce((sum, proof) => sum + (proof?.amount || 0), 0);
          recordNutzapRedemption({
            eventId: entry.source.eventId,
            senderPubkey: entry.source.senderPubkey,
            relay: entry.source.relay,
            mintUrl: targetManager.mintUrl,
            amountSat,
          });
        }
        removePendingToken(entry.id);
        if (targetManager === manager) {
          setBalance(targetManager.balance);
          setProofs(targetManager.proofs);
        }
        refreshTotalBalance();
        return { proofs: tokenProofs, mintUrl: targetManager.mintUrl };
      }
      const receiveTokenFromEntry = async () => targetManager.receiveToken(tokenToRedeem);
      const proofs = await receiveTokenFromEntry().catch(async (error) => {
        if (!isTokenAlreadySpentError(error)) {
          throw error;
        }

        const proofsToCheck = freshProofs.length ? freshProofs : tokenProofs;
        if (!proofsToCheck.length) {
          throw error;
        }
        const states = await MintSession.checkTokenStates(normalizeMintUrl(targetManager.mintUrl), proofsToCheck);
        const spendableProofs = proofsToCheck.filter((proof, index) => {
          const stateLabel = typeof states[index]?.state === "string" ? states[index]!.state.toUpperCase() : "";
          return stateLabel !== "SPENT";
        });
        if (!spendableProofs.length) {
          removePendingToken(entry.id);
          throw new Error("Token already spent");
        }
        const partialToken = getEncodedToken({
          mint: targetManager.mintUrl,
          proofs: spendableProofs,
          unit: targetManager.unit,
        });
        return targetManager.receiveToken(partialToken);
      });
      if (entry.source?.type === "nutzap") {
        const amountSat = proofs.reduce((sum, proof) => sum + (proof?.amount || 0), 0);
        recordNutzapRedemption({
          eventId: entry.source.eventId,
          senderPubkey: entry.source.senderPubkey,
          relay: entry.source.relay,
          mintUrl: targetManager.mintUrl,
          amountSat,
        });
      }
      removePendingToken(entry.id);
      if (targetManager === manager) {
        setBalance(targetManager.balance);
        setProofs(targetManager.proofs);
      }
      refreshTotalBalance();
      return { proofs, mintUrl: targetManager.mintUrl };
    },
    [ensureManagerForMint, manager, recordNutzapRedemption, refreshTotalBalance, setBalance, setProofs],
  );

  const redeemPendingTokens = useCallback(async () => {
    if (redeemingPendingRef.current) return;
    let entries: PendingTokenEntry[] = [];
    try {
      entries = listPendingTokens();
    } catch {
      entries = [];
    }
    if (!entries.length) return;
    redeemingPendingRef.current = true;
    try {
      for (const entry of entries) {
        try {
          await processPendingEntry(entry);
        } catch (err: any) {
          const message = err?.message ? String(err.message) : String(err ?? "");
          markPendingTokenAttempt(entry.id, message);
          if (isLikelyOfflineError(err)) {
            break;
          }
        }
      }
    } finally {
      redeemingPendingRef.current = false;
      refreshTotalBalance();
      requestNip60Sync();
    }
  }, [processPendingEntry, refreshTotalBalance, requestNip60Sync]);

  const savePendingTokenForRedemption = useCallback(
    async (rawToken: string): Promise<SavePendingTokenResult> => {
      if (!manager) throw new Error("Wallet not ready");
      const tokenInput = rawToken.trim();
      if (!tokenInput) throw new Error("Paste a Cashu token");

      let decoded: any = null;
      try {
        decoded = getDecodedToken(tokenInput);
      } catch {
        decoded = null;
      }

      const entries: any[] = decoded
        ? Array.isArray(decoded?.token)
          ? decoded.token
          : decoded?.proofs
            ? [decoded]
            : []
        : [];

      const tokenAmount = entries.length
        ? entries.reduce((outer, entry) => {
            const proofs = Array.isArray(entry?.proofs) ? entry.proofs : [];
            return (
              outer +
              proofs.reduce((sum, proof) => {
                const amt = typeof proof?.amount === "number" ? proof.amount : 0;
                return sum + (Number.isFinite(amt) ? amt : 0);
              }, 0)
            );
          }, 0)
        : deriveTokenAmount(tokenInput);

      const selectMint = (entry: any) => (entry && typeof entry.mint === "string" ? entry.mint : null);
      const primaryMint = entries.find((entry) => selectMint(entry))?.mint ?? null;
      const activeMint = manager.mintUrl;
      const targetMintUrl = primaryMint ?? activeMint;
      if (!targetMintUrl) {
        throw new Error("Unable to determine mint for token");
      }

      const normalizedTarget = normalizeMintUrl(targetMintUrl);
      addMintToList(normalizedTarget);
      requestNip60Sync();

      const entry = addPendingToken(targetMintUrl, tokenInput, tokenAmount || undefined);
      refreshTotalBalance();

      const crossMint = normalizeMintUrl(activeMint) !== normalizedTarget;

      return {
        id: entry.id,
        amountSat: tokenAmount || undefined,
        mintUrl: targetMintUrl,
        crossMint,
      };
    },
    [manager, refreshTotalBalance, requestNip60Sync],
  );

  const redeemPendingToken = useCallback(
    async (id: string) => {
      if (redeemingPendingRef.current) {
        throw new Error("Another redemption is already in progress. Please try again shortly.");
      }
      let entry: PendingTokenEntry | undefined;
      try {
        entry = listPendingTokens().find((item) => item.id === id);
      } catch {
        entry = undefined;
      }
      if (!entry) {
        throw new Error("Saved token not found");
      }
      redeemingPendingRef.current = true;
      try {
        const res = await processPendingEntry(entry);
        setTimeout(() => {
          redeemPendingTokens().catch(() => {});
        }, 0);
        return res;
      } catch (err: any) {
        const message = err?.message ? String(err.message) : String(err ?? "");
        markPendingTokenAttempt(entry.id, message);
        throw err;
      } finally {
        redeemingPendingRef.current = false;
        refreshTotalBalance();
      }
    },
    [processPendingEntry, redeemPendingTokens, refreshTotalBalance],
  );

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setInfo(null);
    refreshTotalBalance();
    const key = mintUrl || null;

    const existing = mintBootPromisesRef.current.get(key);
    const bootPromise =
      existing ||
      (async () => {
        if (!mintUrl) {
          return { manager: null, balance: 0, proofs: [], info: null };
        }
        try {
          const session = MintSession.init({
            getP2PKPrivkey: getLocalP2PKPrivkey,
            onP2PKUsage: (pubkey, count) => markKeyUsed(pubkey, count),
          });
          const m = await session.getConnection(mintUrl);
          const mi = await m.getMintInfo();
          return {
            manager: m,
            balance: m.balance,
            proofs: m.proofs,
            info: { name: mi?.name, unit: (mi as any)?.unit ?? "sat", version: mi?.version },
          };
        } catch (e) {
          console.error("Failed to init Cashu", e);
          return { manager: null, balance: 0, proofs: [], info: null };
        }
      })().finally(() => {
        mintBootPromisesRef.current.delete(key);
      });

    mintBootPromisesRef.current.set(key, bootPromise);

    bootPromise
      .then((result) => {
        if (cancelled) return;
        setManager(result.manager);
        setBalance(result.balance);
        setProofs(result.proofs);
        setInfo(result.info);
        refreshTotalBalance();
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, [getLocalP2PKPrivkey, markKeyUsed, mintUrl, refreshTotalBalance]);

  useEffect(() => {
    redeemPendingTokens();
  }, [redeemPendingTokens, manager]);

  useEffect(() => {
    if (!nip60SyncNonce) return;
    if (nip60SyncInFlightRef.current) {
      nip60SyncPendingRef.current = true;
      return;
    }
    const execute = async () => {
      await runNip60Sync();
      if (nip60SyncPendingRef.current) {
        nip60SyncPendingRef.current = false;
        requestNip60Sync();
      }
    };
    void execute();
  }, [nip60SyncNonce, requestNip60Sync, runNip60Sync]);

  useEffect(() => {
    requestNip60Sync();
  }, [requestNip60Sync]);

  useEffect(() => {
    requestNip60Sync();
  }, [primaryKey?.privateKey, requestNip60Sync]);

  useEffect(() => {
    const handler = () => requestNip60Sync();
    window.addEventListener("taskify:wallet-history-updated", handler);
    return () => window.removeEventListener("taskify:wallet-history-updated", handler);
  }, [requestNip60Sync]);

  useEffect(() => {
    // Detect freshly added Nostr keys (nsec/nsec hex) and trigger sync automatically.
    let last = loadNostrKeys();
    nostrKeysCacheRef.current = last;
    const check = () => {
      const next = loadNostrKeys();
      const changed = (next?.sk || null) !== (last?.sk || null);
      if (changed) {
        last = next;
        requestNip60Sync();
      }
    };
    const interval = window.setInterval(check, 4000);
    window.addEventListener("focus", check);
    return () => {
      window.removeEventListener("focus", check);
      clearInterval(interval);
    };
  }, [loadNostrKeys, requestNip60Sync]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () => {
      redeemPendingTokens();
      requestNip60Sync();
    };
    window.addEventListener("online", handler);
    return () => {
      window.removeEventListener("online", handler);
    };
  }, [redeemPendingTokens, requestNip60Sync]);

  const setMintUrl = useCallback(async (url: string) => {
    const clean = url.trim().replace(/\/$/, "");
    setMintUrlState(clean);
    persistActiveMint(clean);
    if (clean) {
      addMintToList(clean);
    }
    requestNip60Sync();
  }, [requestNip60Sync]);

  const createMintInvoice = useCallback(
    async (amount: number, description?: string, options?: { mintUrl?: string }) => {
      const overrideUrl = options?.mintUrl;
      const normalizedOverride = overrideUrl ? normalizeMintUrl(overrideUrl) : null;
      const activeNormalized = manager ? normalizeMintUrl(manager.mintUrl) : null;

      let targetManager: MintConnection | null = null;
      if (normalizedOverride) {
        if (manager && normalizedOverride === activeNormalized) {
          targetManager = manager;
        } else if (overrideUrl) {
          targetManager = await ensureManagerForMint(overrideUrl);
        }
      } else if (manager) {
        targetManager = manager;
      }

      if (!targetManager) throw new Error("Wallet not ready");

      const q = await targetManager.createMintInvoice(amount, description);
      const derivedAmount = typeof q.amount === "number" ? q.amount : amount;
      const derivedUnit = (q as any)?.unit ?? (targetManager === manager ? info?.unit : targetManager.unit);
      const mintUrlValue = normalizeMintUrl(targetManager.mintUrl);
      return {
        request: q.request,
        quote: q.quote,
        expiry: q.expiry,
        amount: derivedAmount,
        unit: derivedUnit,
        mintUrl: mintUrlValue,
      };
    },
    [ensureManagerForMint, info?.unit, manager],
  );

  const checkMintQuote = useCallback(
    async (quoteId: string, options?: { mintUrl?: string }) => {
      const overrideUrl = options?.mintUrl;
      const normalizedOverride = overrideUrl ? normalizeMintUrl(overrideUrl) : null;
      const activeNormalized = manager ? normalizeMintUrl(manager.mintUrl) : null;

      let targetManager: MintConnection | null = null;
      if (normalizedOverride) {
        if (manager && normalizedOverride === activeNormalized) {
          targetManager = manager;
        } else if (overrideUrl) {
          targetManager = await ensureManagerForMint(overrideUrl);
        }
      } else if (manager) {
        targetManager = manager;
      }

      if (!targetManager) throw new Error("Wallet not ready");
      const q = await targetManager.checkMintQuote(quoteId);
      return q.state;
    },
    [ensureManagerForMint, manager],
  );

  const claimMint = useCallback(
    async (quoteId: string, amount: number, options?: { mintUrl?: string }) => {
      const overrideUrl = options?.mintUrl;
      const normalizedOverride = overrideUrl ? normalizeMintUrl(overrideUrl) : null;
      const activeNormalized = manager ? normalizeMintUrl(manager.mintUrl) : null;

      let targetManager: MintConnection | null = null;
      if (normalizedOverride) {
        if (manager && normalizedOverride === activeNormalized) {
          targetManager = manager;
        } else if (overrideUrl) {
          targetManager = await ensureManagerForMint(overrideUrl);
        }
      } else if (manager) {
        targetManager = manager;
      }

      if (!targetManager) throw new Error("Wallet not ready");
      const proofs = await targetManager.claimMint(quoteId, amount);
      if (targetManager === manager) {
        setBalance(targetManager.balance);
        setProofs(targetManager.proofs);
      }
      refreshTotalBalance();
      requestNip60Sync();
      return proofs;
    },
    [ensureManagerForMint, manager, refreshTotalBalance, requestNip60Sync, setBalance, setProofs],
  );

  const receiveToken = useCallback(
    async (rawToken: string) => {
      if (!manager) throw new Error("Wallet not ready");
      const tokenInput = rawToken.trim();
      if (!tokenInput) throw new Error("Paste a Cashu token");

      let decoded: any = null;
      try {
        decoded = getDecodedToken(tokenInput);
      } catch {
        decoded = null;
      }

      const entries: any[] = decoded
        ? Array.isArray(decoded?.token)
          ? decoded.token
          : decoded?.proofs
            ? [decoded]
            : []
        : [];
      const tokenAmount = entries.length
        ? entries.reduce((outer, entry) => {
            const proofs = Array.isArray(entry?.proofs) ? entry.proofs : [];
            return (
              outer +
              proofs.reduce((sum, proof) => {
                const amt = typeof proof?.amount === "number" ? proof.amount : 0;
                return sum + (Number.isFinite(amt) ? amt : 0);
              }, 0)
            );
          }, 0)
        : deriveTokenAmount(tokenInput);
      const selectMint = (entry: any) => (entry && typeof entry.mint === "string" ? entry.mint : null);
      const primaryMint = entries.find((entry) => selectMint(entry))?.mint ?? null;
      const activeMint = normalizeMintUrl(manager.mintUrl);
      const crossMintNeeded = primaryMint && normalizeMintUrl(primaryMint) !== activeMint;

      const queueForLater = (mintUrl: string, cross: boolean): ReceiveTokenResult => {
        const entry = addPendingToken(mintUrl, tokenInput, tokenAmount || undefined);
        refreshTotalBalance();
        return {
          proofs: [],
          usedMintUrl: mintUrl,
          activeMintUrl: manager.mintUrl,
          crossMint: cross,
          savedForLater: true,
          pendingTokenId: entry.id,
          pendingTokenAmount: tokenAmount || undefined,
        };
      };

      const receiveWithManager = async (target: MintConnection, cross: boolean): Promise<ReceiveTokenResult> => {
        const tokenProofs = extractProofsForMint(tokenInput, target.mintUrl);
        const existingSecrets = new Set(
          target.proofs
            .map((proof) => (typeof proof?.secret === "string" ? proof.secret : ""))
            .filter(Boolean),
        );
        const freshProofs = tokenProofs.filter(
          (proof) => typeof proof?.secret === "string" && !existingSecrets.has(proof.secret),
        );
        let tokenToRedeem = tokenInput;
        if (freshProofs.length && freshProofs.length < tokenProofs.length) {
          tokenToRedeem = getEncodedToken({
            mint: target.mintUrl,
            proofs: freshProofs,
            unit: target.unit,
          });
        }
        if (tokenProofs.length && freshProofs.length === 0) {
          if (cross) {
            refreshTotalBalance();
          } else {
            setBalance(manager.balance);
            setProofs(manager.proofs);
            refreshTotalBalance();
          }
          requestNip60Sync();
          redeemPendingTokens().catch(() => {});
          return {
            proofs: tokenProofs,
            usedMintUrl: target.mintUrl,
            activeMintUrl: manager.mintUrl,
            crossMint: cross,
            savedForLater: false,
          };
        }
        const proofs = await target.receiveToken(tokenToRedeem);
        if (cross) {
          refreshTotalBalance();
        } else {
          setBalance(manager.balance);
          setProofs(manager.proofs);
          refreshTotalBalance();
        }
        requestNip60Sync();
        redeemPendingTokens().catch(() => {});
        return {
          proofs,
          usedMintUrl: target.mintUrl,
          activeMintUrl: manager.mintUrl,
          crossMint: cross,
          savedForLater: false,
        };
      };

      if (crossMintNeeded && primaryMint) {
        try {
          const other = await ensureManagerForMint(primaryMint);
          return await receiveWithManager(other, true);
        } catch (err) {
          if (isLikelyOfflineError(err)) {
            return queueForLater(primaryMint, true);
          }
          throw err;
        }
      }

      try {
        return await receiveWithManager(manager, false);
      } catch (err: any) {
        const message = err?.message?.toLowerCase?.() ?? "";
        if (message.includes("different mint") && primaryMint) {
          try {
            const other = await ensureManagerForMint(primaryMint);
            return await receiveWithManager(other, true);
          } catch (innerErr) {
            if (isLikelyOfflineError(innerErr)) {
              return queueForLater(primaryMint, true);
            }
            throw innerErr;
          }
        }
        if (isLikelyOfflineError(err)) {
          const targetMint = primaryMint ?? manager.mintUrl;
          const cross = !!primaryMint && normalizeMintUrl(primaryMint) !== activeMint;
          return queueForLater(targetMint, cross);
        }
        throw err;
      }
    },
    [manager, ensureManagerForMint, refreshTotalBalance, requestNip60Sync, setBalance, setProofs, redeemPendingTokens],
  );

  const markNutzapProcessed = useCallback((eventId: string, createdAt?: number) => {
    const id = eventId.trim();
    if (!id) return;
    nip61ProcessedRef.current.add(id);
    persistStoredStringSet(LS_NIP61_PROCESSED, nip61ProcessedRef.current);
    const ts = typeof createdAt === "number" ? createdAt : 0;
    if (Number.isFinite(ts) && ts > (nip61SinceRef.current || 0)) {
      nip61SinceRef.current = Math.floor(ts);
      persistStoredSince(LS_NIP61_SINCE, nip61SinceRef.current);
    }
  }, []);

  const handleNutzapEvent = useCallback(
    async (event: NostrEvent, relayUrl?: string) => {
      const keys = loadNostrKeys();
      if (!keys) return;
      const parsed = parseNutzapEvent(event);
      if (!parsed) return;
      const recipient = parsed.recipientPubkey?.toLowerCase();
      if (recipient && recipient !== keys.pk.toLowerCase()) return;

      if (nip61ProcessedRef.current.has(parsed.id) || nip61InFlightRef.current.has(parsed.id)) return;

      const allowedMints = new Set(getMintList().map((mint) => normalizeMintUrl(mint)));
      if (!allowedMints.has(parsed.mintUrl)) return;

      const walletPrivkey = getWalletPrivkeyForSync();
      const p2pkPubkey = walletPrivkey ? deriveCompressedPubkeyFromSecret(walletPrivkey) : null;
      if (!p2pkPubkey) return;

      if (parsed.proofs.some((proof) => !proofIsLockedToPubkey(proof, p2pkPubkey))) return;
      if (parsed.proofs.some((proof) => !proof.dleq)) return;

      const token = getEncodedToken({ mint: parsed.mintUrl, proofs: parsed.proofs, unit: parsed.unit });
      nip61InFlightRef.current.add(parsed.id);
      try {
        try {
          const conn = await ensureManagerForMint(parsed.mintUrl);
          conn.validateProofsDleq(parsed.proofs);
        } catch (error) {
          if (isLikelyOfflineError(error)) {
            const amountSat = parsed.proofs.reduce((sum, proof) => sum + (proof?.amount || 0), 0);
            addPendingToken(parsed.mintUrl, token, amountSat || undefined, {
              type: "nutzap",
              eventId: parsed.id,
              senderPubkey: parsed.senderPubkey,
              relay: relayUrl,
            });
            refreshTotalBalance();
            markNutzapProcessed(parsed.id, parsed.created_at);
            return;
          }
          throw error;
        }

        const result = await receiveToken(token);
        if (result.savedForLater && result.pendingTokenId) {
          setPendingTokenSource(result.pendingTokenId, {
            type: "nutzap",
            eventId: parsed.id,
            senderPubkey: parsed.senderPubkey,
            relay: relayUrl,
          });
        }
        if (!result.savedForLater) {
          const amountSat = parsed.proofs.reduce((sum, proof) => sum + (proof?.amount || 0), 0);
          recordNutzapRedemption({
            eventId: parsed.id,
            senderPubkey: parsed.senderPubkey,
            relay: relayUrl,
            mintUrl: parsed.mintUrl,
            amountSat,
          });
        }
        markNutzapProcessed(parsed.id, parsed.created_at);
      } catch (error) {
        if (!isLikelyOfflineError(error)) {
          console.warn("NIP-61: failed to process nutzap", error);
        }
      } finally {
        nip61InFlightRef.current.delete(parsed.id);
      }
    },
    [
      ensureManagerForMint,
      getWalletPrivkeyForSync,
      loadNostrKeys,
      markNutzapProcessed,
      recordNutzapRedemption,
      receiveToken,
      refreshTotalBalance,
    ],
  );

  useEffect(() => {
    if (!walletSyncEnabled) return;
    const keys = loadNostrKeys();
    if (!keys) return;
    const relays = loadDefaultNostrRelays().filter(Boolean);
    if (!relays.length) return;
    const since = nip61SinceRef.current || loadStoredSince(LS_NIP61_SINCE);
    const mints = getMintList().map((mint) => normalizeMintUrl(mint)).filter(Boolean);

    const filter: Record<string, unknown> = {
      kinds: [NIP61_NUTZAP_KIND],
      "#p": [keys.pk],
    };
    if (mints.length) {
      (filter as any)["#u"] = mints;
    }
    if (since) {
      (filter as any).since = since;
    }

    let cancelled = false;
    const stopExisting = nip61SubscriptionReleaseRef.current;
    if (stopExisting) {
      try {
        stopExisting();
      } catch {
        // ignore
      }
      nip61SubscriptionReleaseRef.current = null;
    }

    (async () => {
      try {
        const session = await NostrSession.init(relays);
        const sub = await session.subscribe([filter as any], {
          relayUrls: relays,
          onEvent: (ev, relayUrl) => {
            handleNutzapEvent(ev as NostrEvent, relayUrl).catch((err) => {
              console.warn("NIP-61: nutzap handler error", err);
            });
          },
          opts: { closeOnEose: false },
        });
        if (cancelled) {
          sub.release();
          return;
        }
        nip61SubscriptionReleaseRef.current = sub.release;
      } catch (error) {
        if (!isLikelyOfflineError(error)) {
          console.warn("NIP-61: failed to subscribe for nutzaps", error);
        }
      }
    })();

    return () => {
      cancelled = true;
      const stop = nip61SubscriptionReleaseRef.current;
      if (stop) {
        try {
          stop();
        } catch {
          // ignore
        }
      }
      nip61SubscriptionReleaseRef.current = null;
    };
  }, [handleNutzapEvent, loadNostrKeys, walletSyncEnabled, mintUrl]);

  const createSendToken = useCallback(async (
    amount: number,
    options?: CreateSendTokenOptions & { mintUrl?: string },
  ) => {
    const overrideUrl = options?.mintUrl;
    const normalizedOverride = overrideUrl ? normalizeMintUrl(overrideUrl) : null;
    const activeNormalized = manager ? normalizeMintUrl(manager.mintUrl) : null;

    let targetManager: MintConnection | null = null;
    if (normalizedOverride) {
      if (manager && normalizedOverride === activeNormalized) {
        targetManager = manager;
      } else if (overrideUrl) {
        targetManager = await ensureManagerForMint(overrideUrl);
      }
    } else if (manager) {
      targetManager = manager;
    }

    if (!targetManager) throw new Error("Wallet not ready");

    const sendOptions: CreateSendTokenOptions = options ?? {};
    const res = await targetManager.createSendToken(amount, sendOptions);

    if (targetManager === manager) {
      setBalance(manager.balance);
      setProofs(manager.proofs);
    } else {
      const normalizedTarget = normalizeMintUrl(targetManager.mintUrl);
      if (normalizedTarget === activeNormalized) {
        setBalance(targetManager.balance);
        setProofs(targetManager.proofs);
      }
    }
    refreshTotalBalance();
    requestNip60Sync();

    return { token: res.token, proofs: res.send, mintUrl: targetManager.mintUrl, lockInfo: res.lockInfo };
  }, [ensureManagerForMint, manager, refreshTotalBalance, requestNip60Sync]);

  const createTokenFromProofSelection = useCallback(
    async (secrets: string[]) => {
      if (!manager) throw new Error("Wallet not ready");
      const res = await manager.createTokenFromProofSecrets(secrets);
      setBalance(manager.balance);
      setProofs(manager.proofs);
      refreshTotalBalance();
      requestNip60Sync();
      return { token: res.token, proofs: res.send, mintUrl: manager.mintUrl };
    },
    [manager, refreshTotalBalance, requestNip60Sync],
  );

  const payInvoice = useCallback(
    async (invoice: string, options?: { mintUrl?: string }) => {
      const overrideUrl = options?.mintUrl;
      const normalizedOverride = overrideUrl ? normalizeMintUrl(overrideUrl) : null;
      const activeNormalized = manager ? normalizeMintUrl(manager.mintUrl) : null;

      let targetManager: MintConnection | null = null;
      if (normalizedOverride) {
        if (manager && normalizedOverride === activeNormalized) {
          targetManager = manager;
        } else if (overrideUrl) {
          targetManager = await ensureManagerForMint(overrideUrl);
        }
      } else if (manager) {
        targetManager = manager;
      }

      if (!targetManager) throw new Error("Wallet not ready");

      let invoiceAmountSat: number | null = null;
      try {
        const { amountMsat } = decodeBolt11Amount(invoice);
        if (amountMsat !== null) {
          if (amountMsat < 0) throw new Error("Invalid invoice amount");
          const satValue = amountMsat / 1000n;
          if (satValue > BigInt(Number.MAX_SAFE_INTEGER)) {
            throw new Error("Invoice amount too large");
          }
          invoiceAmountSat = Number(satValue);
        }
      } catch (error) {
        console.warn("Cashu: failed to decode invoice amount", error);
        invoiceAmountSat = null;
      }

      const baseQuote = await targetManager.createMeltQuote(invoice);
      const required = (baseQuote.amount || 0) + (baseQuote.fee_reserve || 0);
      const baseFeeReserve =
        typeof baseQuote.fee_reserve === "number" && Number.isFinite(baseQuote.fee_reserve)
          ? baseQuote.fee_reserve
          : null;
      const baseAmount =
        typeof baseQuote.amount === "number" && Number.isFinite(baseQuote.amount)
          ? baseQuote.amount
          : invoiceAmountSat;

      if (targetManager.balance >= required) {
        const singleResult = await targetManager.payMeltQuote(baseQuote);
        if (targetManager === manager) {
          setBalance(manager.balance);
          setProofs(manager.proofs);
        }
        refreshTotalBalance();
        requestNip60Sync();
        return {
          state: (singleResult.quote as any)?.state ?? "",
          amountSat: invoiceAmountSat ?? baseAmount ?? null,
          feeReserveSat: baseFeeReserve,
          mintUrl: targetManager.mintUrl,
        };
      }

      if (targetManager !== manager) {
        throw new Error("Insufficient balance for selected mint");
      }

      const resolvedTotalAmount =
        invoiceAmountSat != null
          ? invoiceAmountSat
          : typeof baseQuote.amount === "number" && Number.isFinite(baseQuote.amount) && baseQuote.amount > 0
            ? baseQuote.amount
            : null;
      if (resolvedTotalAmount == null || resolvedTotalAmount <= 0) {
        throw new Error("Invoice amount must be specified for multi-mint payments");
      }

      const store = loadStore();
      const normalizedActive = normalizeMintUrl(manager.mintUrl);
      const managerCache = new Map<string, MintConnection>();
      managerCache.set(normalizedActive, manager);
      const session = MintSession.init({
        getP2PKPrivkey: getLocalP2PKPrivkey,
        onP2PKUsage: (pubkey, count) => markKeyUsed(pubkey, count),
      });

      const ensureManager = async (mintUrl: string) => {
        const normalized = normalizeMintUrl(mintUrl);
        if (managerCache.has(normalized)) {
          return managerCache.get(normalized)!;
        }
        const temp = await session.getConnection(mintUrl);
        managerCache.set(normalized, temp);
        return temp;
      };

      type CandidateInfo = {
        manager: MintConnection;
        balance: number;
        isActive: boolean;
        supportsMPP: boolean;
      };
      const candidates: CandidateInfo[] = [];
      const seen = new Set<string>();

      const considerMint = async (mintUrl: string) => {
        const normalized = normalizeMintUrl(mintUrl);
        if (seen.has(normalized)) return;
        try {
          const mgr = await ensureManager(mintUrl);
          const balance = mgr.balance;
          if (!balance || balance <= 0) {
            seen.add(normalized);
            return;
          }
          let supportsMPP = false;
          try {
            supportsMPP = await mgr.supportsBolt11MultiPathPayments();
          } catch {
            supportsMPP = false;
          }
          candidates.push({
            manager: mgr,
            balance,
            isActive: normalized === normalizedActive,
            supportsMPP,
          });
          seen.add(normalized);
        } catch (error) {
          console.warn("Cashu: failed to prepare manager for multi-mint payment", error);
        }
      };

      await considerMint(manager.mintUrl);
      for (const mintUrl of Object.keys(store)) {
        await considerMint(mintUrl);
      }

      if (!candidates.length) {
        throw new Error("No available mints support multi-path payments");
      }

      candidates.sort((a, b) => {
        if (a.supportsMPP && !b.supportsMPP) return -1;
        if (!a.supportsMPP && b.supportsMPP) return 1;
        if (a.isActive && !b.isActive) return -1;
        if (!a.isActive && b.isActive) return 1;
        return b.balance - a.balance;
      });

      let remaining = resolvedTotalAmount;
      const plans: Array<{ manager: MintConnection; quote: MeltQuoteResponse; amount: number }> = [];
      let totalFeeReserve = 0;

      for (const info of candidates) {
        if (remaining <= 0) break;
        const target = Math.min(remaining, info.balance);
        if (target <= 0) continue;
        try {
          const prepared = await info.manager.prepareMultiPathMeltQuote(invoice, target);
          if (!prepared || prepared.amount <= 0) continue;
          plans.push({ manager: info.manager, quote: prepared.quote, amount: prepared.amount });
          const feeReserve = typeof prepared.quote.fee_reserve === "number" ? prepared.quote.fee_reserve : 0;
          if (Number.isFinite(feeReserve) && feeReserve > 0) {
            totalFeeReserve += feeReserve;
          }
          remaining -= prepared.amount;
        } catch (error) {
          console.warn("Cashu: failed to prepare multi-path quote", error);
        }
      }

      if (remaining > 0) {
        throw new Error("Insufficient balance across all mints for invoice + fees");
      }

      let finalResult: MeltProofsResponse | null = null;
      for (const plan of plans) {
        const result = await plan.manager.payMeltQuote(plan.quote);
        if (plan.manager === manager) {
          setBalance(manager.balance);
          setProofs(manager.proofs);
        }
        finalResult = result;
      }

      setBalance(manager.balance);
      setProofs(manager.proofs);
      refreshTotalBalance();
      requestNip60Sync();

      if (!finalResult) {
        throw new Error("Failed to complete multi-mint payment");
      }

      return {
        state: (finalResult.quote as any)?.state ?? "",
        amountSat: resolvedTotalAmount,
        feeReserveSat: totalFeeReserve || null,
        mintUrl: manager.mintUrl,
      };
    },
    [
      ensureManagerForMint,
      getLocalP2PKPrivkey,
      manager,
      markKeyUsed,
      refreshTotalBalance,
      requestNip60Sync,
      setBalance,
      setProofs,
    ],
  );

  const checkProofStates = useCallback(async (targetMintUrl: string, proofsToCheck: Proof[]) => {
    const normalizedTarget = targetMintUrl.trim().replace(/\/$/, "");
    if (!normalizedTarget) throw new Error("Missing mint URL");
    MintSession.init({
      getP2PKPrivkey: getLocalP2PKPrivkey,
      onP2PKUsage: (pubkey, count) => markKeyUsed(pubkey, count),
    });
    return MintSession.checkTokenStates(normalizedTarget, proofsToCheck);
  }, [getLocalP2PKPrivkey, markKeyUsed]);

  const subscribeProofStateUpdates = useCallback(
    async (
      targetMintUrl: string,
      proofsToSubscribe: Proof[],
      callback: (payload: ProofState & { proof: Proof }) => void,
      onError: (e: Error) => void,
    ) => {
      const normalizedTarget = targetMintUrl.trim().replace(/\/$/, "");
      if (!normalizedTarget) throw new Error("Missing mint URL");
      if (!proofsToSubscribe.length) throw new Error("No proofs to subscribe");

      MintSession.init({
        getP2PKPrivkey: getLocalP2PKPrivkey,
        onP2PKUsage: (pubkey, count) => markKeyUsed(pubkey, count),
      });
      const cancel = await MintSession.subscribeToProofState(normalizedTarget, proofsToSubscribe, callback, onError);
      return () => cancel();
    },
    [getLocalP2PKPrivkey, markKeyUsed],
  );

  const subscribeMintQuoteUpdates = useCallback(
    async (
      targetMintUrl: string,
      quoteIds: string[],
      callback: (quote: MintQuoteResponse) => void,
      onError: (e: Error) => void,
    ) => {
      const normalizedTarget = targetMintUrl.trim().replace(/\/$/, "");
      if (!normalizedTarget) throw new Error("Missing mint URL");
      if (!quoteIds.length) throw new Error("No mint quote IDs provided");

      MintSession.init({
        getP2PKPrivkey: getLocalP2PKPrivkey,
        onP2PKUsage: (pubkey, count) => markKeyUsed(pubkey, count),
      });
      const cancel = await MintSession.subscribeToQuote(normalizedTarget, quoteIds, callback, onError);
      return () => cancel();
    },
    [getLocalP2PKPrivkey, markKeyUsed],
  );

  const value = useMemo<CashuContextType>(() => ({
    ready,
    mintUrl,
    setMintUrl,
    balance,
    totalBalance,
    pendingBalance,
    proofs,
    info,
    createMintInvoice,
    checkMintQuote,
    claimMint,
    savePendingTokenForRedemption,
    receiveToken,
    createSendToken,
    payInvoice,
    checkProofStates,
    subscribeProofStateUpdates,
    subscribeMintQuoteUpdates,
    createTokenFromProofSelection,
    redeemPendingToken,
    walletSyncEnabled,
    setWalletSyncEnabled,
  }), [
    ready,
    mintUrl,
    setMintUrl,
    balance,
    totalBalance,
    pendingBalance,
    proofs,
    info,
    createMintInvoice,
    checkMintQuote,
    claimMint,
    savePendingTokenForRedemption,
    receiveToken,
    createSendToken,
    payInvoice,
    checkProofStates,
    subscribeProofStateUpdates,
    subscribeMintQuoteUpdates,
    createTokenFromProofSelection,
    redeemPendingToken,
    walletSyncEnabled,
    setWalletSyncEnabled,
  ]);

  return <CashuContext.Provider value={value}>{children}</CashuContext.Provider>;
}

export function useCashu() {
  const ctx = useContext(CashuContext);
  if (!ctx) throw new Error("useCashu must be used within CashuProvider");
  return ctx;
}
