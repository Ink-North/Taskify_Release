import { getPublicKey, nip04, nip19, type EventTemplate } from "nostr-tools";
import { NostrSession } from "../nostr/NostrSession";

export type ParsedNwcUri = {
  uri: string;
  relayUrls: string[];
  walletPubkey: string; // hex
  walletNpub: string;
  clientSecretHex: string;
  clientSecretBytes: Uint8Array;
  clientPubkey: string; // hex
  clientNpub: string;
  walletName?: string;
  walletLud16?: string;
};

export type NwcResponse<T> = {
  result?: T;
  error?: { code?: string; message?: string };
};

const NWC_EVENT_KIND_REQUEST = 23194;
const NWC_EVENT_KIND_RESPONSE = 23195;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim().toLowerCase().replace(/^0x/, "");
  if (clean.length % 2 !== 0) throw new Error("Invalid hex");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = clean.slice(i * 2, i * 2 + 2);
    out[i] = parseInt(byte, 16);
    if (Number.isNaN(out[i])) throw new Error("Invalid hex");
  }
  return out;
}

function normalizeRelay(url: string): string {
  const clean = (input: string) => {
    const parsed = new URL(input);
    const proto = parsed.protocol.toLowerCase();
    if (proto !== "wss:" && proto !== "ws:") throw new Error();
    parsed.hash = "";
    let pathname = parsed.pathname || "/";
    if (!pathname.startsWith("/")) pathname = `/${pathname}`;
    const search = parsed.search || "";
    return `${proto}//${parsed.host}${pathname}${search}`;
  };
  try {
    return clean(url);
  } catch {
    try {
      return clean(`wss://${url}`);
    } catch {
      throw new Error(`Invalid relay URL: ${url}`);
    }
  }
}

function decodePubkey(raw: string): { hex: string; npub: string; relays?: string[] } {
  const cleaned = raw.trim();
  if (!cleaned) throw new Error("Missing wallet pubkey");
  try {
    const decoded = nip19.decode(cleaned);
    if (decoded.type === "npub") {
      const decodedData: unknown = decoded.data;
      let hex = "";
      if (typeof decodedData === "string") {
        hex = decodedData;
      } else if (decodedData instanceof Uint8Array) {
        hex = bytesToHex(decodedData);
      } else if (Array.isArray(decodedData)) {
        hex = bytesToHex(Uint8Array.from(decodedData as number[]));
      }
      if (/^[0-9a-fA-F]{64}$/.test(hex)) {
        const normalized = hex.toLowerCase();
        return { hex: normalized, npub: nip19.npubEncode(normalized) };
      }
      throw new Error("Unsupported npub payload");
    }
    if (decoded.type === "nprofile") {
      const data = decoded.data as { pubkey: string | Uint8Array; relays?: string[] };
      const pubkey =
        typeof data.pubkey === "string"
          ? data.pubkey
          : data.pubkey instanceof Uint8Array
            ? bytesToHex(data.pubkey)
            : "";
      if (/^[0-9a-fA-F]{64}$/.test(pubkey)) {
        const normalized = pubkey.toLowerCase();
        return { hex: normalized, npub: nip19.npubEncode(normalized), relays: data.relays };
      }
      throw new Error("Unsupported nprofile payload");
    }
  } catch {}
  const hexMatch = cleaned.match(/^[0-9a-fA-F]{64}$/);
  if (hexMatch) {
    const hex = cleaned.toLowerCase();
    return { hex, npub: nip19.npubEncode(hex) };
  }
  throw new Error("Unsupported wallet pubkey format");
}

function decodeSecret(raw: string | null): { hex: string } {
  if (!raw) throw new Error("NWC secret missing");
  const cleaned = raw.trim();
  if (!cleaned) throw new Error("NWC secret missing");
  try {
    const decoded = nip19.decode(cleaned);
    if (decoded.type === "nsec") {
      const decodedData: unknown = decoded.data;
      if (typeof decodedData === "string" && /^[0-9a-fA-F]{64}$/.test(decodedData)) {
        return { hex: decodedData.toLowerCase() };
      }
      if (decodedData instanceof Uint8Array) {
        return { hex: bytesToHex(decodedData) };
      }
      if (Array.isArray(decodedData)) {
        return { hex: bytesToHex(Uint8Array.from(decodedData as number[])) };
      }
    }
  } catch {}
  if (/^[0-9a-fA-F]{64}$/.test(cleaned)) {
    return { hex: cleaned.toLowerCase() };
  }
  throw new Error("Unsupported NWC secret format");
}

export function parseNwcUri(input: string): ParsedNwcUri {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Enter NWC connection URL");
  const prefixMatch = trimmed.match(/^nostr\+walletconnect:\/+(.+)$/i);
  if (!prefixMatch) throw new Error("Invalid NWC URL (must start with nostr+walletconnect://)");
  const remainder = prefixMatch[1];
  const [targetPart, queryPart = ""] = remainder.split("?");
  if (!targetPart) throw new Error("NWC URL missing wallet pubkey");
  const { hex: walletPubkey, npub: walletNpub, relays: relaysFromProfile } = decodePubkey(targetPart);

  const params = new URLSearchParams(queryPart);
  const relayParams = params.getAll("relay").filter(Boolean);
  const relays = new Set<string>();
  for (const r of relaysFromProfile || []) {
    try { relays.add(normalizeRelay(r)); } catch {}
  }
  for (const r of relayParams) {
    try { relays.add(normalizeRelay(r)); } catch {}
  }
  if (!relays.size) throw new Error("NWC URL must include at least one relay");

  const { hex: clientSecretHex } = decodeSecret(params.get("secret"));
  const clientSecretBytes = hexToBytes(clientSecretHex);
  const clientPubkey = getPublicKey(clientSecretBytes);
  const clientNpub = nip19.npubEncode(clientPubkey);

  return {
    uri: trimmed,
    relayUrls: Array.from(relays),
    walletPubkey,
    walletNpub,
    clientSecretHex,
    clientSecretBytes,
    clientPubkey,
    clientNpub,
    walletName: params.get("name") || undefined,
    walletLud16: params.get("lud16") || undefined,
  };
}

export class NwcClient {
  private readonly connection: ParsedNwcUri;

  constructor(connection: ParsedNwcUri) {
    this.connection = connection;
  }

  async request<T = unknown>(method: string, params: Record<string, unknown>, opts?: { timeoutMs?: number }): Promise<T> {
    const { relayUrls } = this.connection;
    if (!relayUrls.length) throw new Error("No relay configured for NWC connection");
    let lastError: Error | null = null;
    for (const relay of relayUrls) {
      try {
        return await this.requestViaRelay<T>(relay, method, params, opts?.timeoutMs);
      } catch (err: any) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }
    throw lastError || new Error("Failed to contact NWC relay");
  }

  private requestViaRelay<T>(relayUrl: string, method: string, params: Record<string, unknown>, timeoutMs = 20000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
      let release: (() => void) | null = null;
      let requestEventId: string | null = null;

      const cleanup = () => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        timeoutHandle = null;
        try { release?.(); } catch {}
        release = null;
      };

      (async () => {
        try {
          const relayList = [relayUrl];
          const session = await NostrSession.init(relayList);
          const payload = JSON.stringify({ method, params });
          const encrypted = await nip04.encrypt(this.connection.clientSecretHex, this.connection.walletPubkey, payload);
          const template: EventTemplate = {
            kind: NWC_EVENT_KIND_REQUEST,
            created_at: Math.floor(Date.now() / 1000),
            content: encrypted,
            tags: [["p", this.connection.walletPubkey], ["t", "nwc"]],
          };
          const subscription = await session.subscribe(
            [{ kinds: [NWC_EVENT_KIND_RESPONSE], "#p": [this.connection.clientPubkey] }],
            {
              relayUrls: relayList,
              onEvent: async (ev) => {
                if (requestEventId) {
                  const eTag = ev.tags.find((t) => t[0] === "e");
                  if (eTag && eTag[1] && eTag[1] !== requestEventId) return;
                }
                try {
                  const decrypted = await nip04.decrypt(this.connection.clientSecretHex, this.connection.walletPubkey, ev.content);
                  const response = JSON.parse(decrypted) as NwcResponse<T>;
                  if (response.error) {
                    const msg = response.error.message || response.error.code || "NWC request failed";
                    cleanup();
                    reject(new Error(msg));
                    return;
                  }
                  cleanup();
                  resolve(response.result as T);
                } catch (err: any) {
                  cleanup();
                  reject(err instanceof Error ? err : new Error(String(err)));
                }
              },
            },
          );
          release = subscription.release;
          const publishResult = await session.publish(template, {
            relayUrls: relayList,
            signer: this.connection.clientSecretBytes,
            returnEvent: true,
          });
          if (typeof publishResult === "object" && (publishResult as any).event?.id) {
            requestEventId = (publishResult as any).event.id as string;
          }
          timeoutHandle = setTimeout(() => {
            cleanup();
            reject(new Error("Timed out waiting for NWC response"));
          }, timeoutMs);
        } catch (error: any) {
          cleanup();
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      })();
    });
  }
}
