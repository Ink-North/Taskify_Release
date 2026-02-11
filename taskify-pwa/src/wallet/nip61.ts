import type { Proof } from "@cashu/cashu-ts";
import type { Event as NostrEvent, EventTemplate } from "nostr-tools";
import { normalizeMintUrl } from "./nip60";

export const NIP61_INFO_KIND = 10019;
export const NIP61_NUTZAP_KIND = 9321;

export type ParsedNutzap = {
  id: string;
  created_at: number;
  senderPubkey: string;
  recipientPubkey?: string;
  content?: string;
  mintUrl: string;
  unit: string;
  proofs: Proof[];
  nutzappedEventId?: string;
  nutzappedRelayHint?: string;
  nutzappedKind?: string;
};

function firstTag(tags: string[][] | undefined, name: string): string[] | null {
  if (!Array.isArray(tags)) return null;
  for (const tag of tags) {
    if (Array.isArray(tag) && tag[0] === name) return tag;
  }
  return null;
}

function firstTagValue(tags: string[][] | undefined, name: string): string | null {
  const tag = firstTag(tags, name);
  const value = tag && typeof tag[1] === "string" ? tag[1].trim() : "";
  return value || null;
}

function allTagValues(tags: string[][] | undefined, name: string): string[] {
  if (!Array.isArray(tags)) return [];
  const values: string[] = [];
  for (const tag of tags) {
    if (!Array.isArray(tag) || tag.length < 2) continue;
    if (tag[0] !== name) continue;
    const value = typeof tag[1] === "string" ? tag[1].trim() : "";
    if (value) values.push(value);
  }
  return values;
}

function parseProofJson(raw: string): Proof | null {
  if (!raw || typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const rawAmount = (parsed as any).amount;
    const amountValue =
      typeof rawAmount === "number" ? rawAmount : typeof rawAmount === "string" ? Number(rawAmount.trim()) : NaN;
    if (!Number.isFinite(amountValue) || amountValue <= 0) return null;
    const secret = typeof (parsed as any).secret === "string" ? (parsed as any).secret.trim() : "";
    const C = typeof (parsed as any).C === "string" ? (parsed as any).C.trim() : "";
    const id = typeof (parsed as any).id === "string" ? (parsed as any).id.trim() : "";
    if (!secret || !C || !id) return null;
    const proof: Proof = {
      amount: Math.floor(amountValue),
      secret,
      C,
      id,
    };
    if ((parsed as any).dleq) {
      proof.dleq = (parsed as any).dleq as Proof["dleq"];
    }
    if ((parsed as any).witness) {
      proof.witness = (parsed as any).witness as Proof["witness"];
    }
    return proof;
  } catch {
    return null;
  }
}

export function parseNutzapEvent(event: NostrEvent): ParsedNutzap | null {
  if (!event || event.kind !== NIP61_NUTZAP_KIND || !event.id) return null;
  const mintRaw = firstTagValue(event.tags, "u");
  if (!mintRaw) return null;
  const mintUrl = normalizeMintUrl(mintRaw);
  if (!mintUrl) return null;
  const unit = (firstTagValue(event.tags, "unit") || "sat").toLowerCase();
  const proofTags = allTagValues(event.tags, "proof");
  const proofs = proofTags.map((raw) => parseProofJson(raw)).filter((p): p is Proof => !!p);
  if (!proofs.length) return null;

  const pTag = firstTagValue(event.tags, "p") || undefined;
  const eTag = firstTag(event.tags, "e");
  const nutzappedEventId = eTag && typeof eTag[1] === "string" ? eTag[1].trim() : undefined;
  const nutzappedRelayHint = eTag && typeof eTag[2] === "string" ? eTag[2].trim() : undefined;
  const nutzappedKind = firstTagValue(event.tags, "k") || undefined;

  return {
    id: event.id,
    created_at: typeof event.created_at === "number" ? event.created_at : 0,
    senderPubkey: event.pubkey,
    recipientPubkey: pTag,
    content: typeof event.content === "string" ? event.content : undefined,
    mintUrl,
    unit,
    proofs,
    nutzappedEventId,
    nutzappedRelayHint,
    nutzappedKind,
  };
}

export function createNutzapInfoEventTemplate(
  params: { relays: string[]; mints: string[]; p2pkPubkey: string; unit?: string },
  options?: { createdAt?: number },
): EventTemplate {
  const created_at = options?.createdAt ?? Math.floor(Date.now() / 1000);
  const tags: string[][] = [];
  const relaySet = new Set(
    (Array.isArray(params.relays) ? params.relays : [])
      .map((relay) => (typeof relay === "string" ? relay.trim() : ""))
      .filter(Boolean),
  );
  relaySet.forEach((relay) => tags.push(["relay", relay]));

  const unit = (params.unit || "sat").toLowerCase();
  const mintSet = new Set(
    (Array.isArray(params.mints) ? params.mints : [])
      .map((mint) => normalizeMintUrl(mint))
      .filter(Boolean),
  );
  mintSet.forEach((mint) => tags.push(["mint", mint, unit]));

  if (params.p2pkPubkey) {
    tags.push(["pubkey", params.p2pkPubkey]);
  }

  return {
    kind: NIP61_INFO_KIND,
    content: "",
    tags,
    created_at,
  };
}

