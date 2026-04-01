import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { finalizeEvent, type EventTemplate, type NostrEvent } from "nostr-tools";
import {
  DEFAULT_FILE_STORAGE_SERVER,
  normalizeFileServerUrl,
  type FileServerEntry,
} from "../lib/fileStorage";

export type Nip96ServerInfo = {
  baseUrl: string;
  apiUrl: string;
  delegatedTo?: string;
};

export type Nip96UploadResult = {
  url: string;
  nip94?: NostrEvent | null;
  response?: any;
  info: Nip96ServerInfo;
};

const NIP96_DISCOVERY_PATH = "/.well-known/nostr/nip96.json";

function encodeBase64(value: string): string {
  try {
    if (typeof btoa === "function") {
      return btoa(unescape(encodeURIComponent(value)));
    }
  } catch {
    // fall back to Buffer if available
  }
  try {
    const globalBuffer = (globalThis as any)?.Buffer;
    if (globalBuffer?.from) {
      return globalBuffer.from(value, "utf8").toString("base64");
    }
  } catch {
    // ignore
  }
  return value;
}

/** Base64url encoding (URL-safe, no padding) required by BUD-11 */
function encodeBase64Url(value: string): string {
  const b64 = encodeBase64(value);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function parseJsonSafe(response: Response): Promise<any> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function discoverNip96Server(baseUrl: string, depth = 0): Promise<Nip96ServerInfo> {
  if (depth > 3) throw new Error("NIP-96 discovery redirected too many times.");
  const normalizedBase = normalizeFileServerUrl(baseUrl) || DEFAULT_FILE_STORAGE_SERVER;
  if (!normalizedBase) {
    throw new Error("Invalid file storage server URL.");
  }
  const discoveryUrl = `${normalizedBase}${NIP96_DISCOVERY_PATH}`;
  const res = await fetch(discoveryUrl, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`Failed to load NIP-96 info (${res.status})`);
  }
  const json = await parseJsonSafe(res);
  if (!json || typeof json !== "object") {
    throw new Error("Invalid NIP-96 discovery response");
  }
  const apiRaw = typeof (json as any).api_url === "string" ? (json as any).api_url.trim() : "";
  const delegatedTo =
    typeof (json as any).delegated_to_url === "string" ? (json as any).delegated_to_url.trim() : "";
  if (!apiRaw && delegatedTo) {
    return discoverNip96Server(delegatedTo, depth + 1);
  }
  if (!apiRaw) {
    throw new Error("NIP-96 api_url missing from discovery response");
  }
  const apiUrl = new URL(apiRaw, normalizedBase).toString();
  return { baseUrl: normalizedBase, apiUrl, delegatedTo: delegatedTo || undefined };
}

function buildNip98AuthHeader(url: string, method: string, payloadHashHex: string, signer: string | Uint8Array): string {
  const signerBytes =
    typeof signer === "string"
      ? hexToBytes(signer.startsWith("0x") ? signer.slice(2) : signer)
      : signer;
  const template: EventTemplate = {
    kind: 27235,
    content: "",
    tags: [
      ["u", url],
      ["method", method.toUpperCase()],
      ["payload", payloadHashHex],
    ],
    created_at: Math.floor(Date.now() / 1000),
  };
  const event = finalizeEvent(template, signerBytes);
  const encoded = encodeBase64(JSON.stringify(event));
  return `Nostr ${encoded}`;
}

function buildBlossomAuthHeader(sha256hex: string, signer: string | Uint8Array): string {
  const signerBytes =
    typeof signer === "string"
      ? hexToBytes(signer.startsWith("0x") ? signer.slice(2) : signer)
      : signer;
  const expiration = Math.floor(Date.now() / 1000) + 300;
  const template: EventTemplate = {
    kind: 24242,
    content: "Upload Blob",
    tags: [
      ["t", "upload"],
      ["x", sha256hex],
      ["expiration", String(expiration)],
    ],
    created_at: Math.floor(Date.now() / 1000),
  };
  const event = finalizeEvent(template, signerBytes);
  return `Nostr ${encodeBase64Url(JSON.stringify(event))}`;
}

async function pollProcessingUrl(url: string, headers: HeadersInit, timeoutMs: number): Promise<{ status: number; data: any }> {
  const started = Date.now();
  let delay = 750;
  let lastData: any = null;
  const absoluteUrl = (() => {
    try {
      return new URL(url).toString();
    } catch {
      return url;
    }
  })();

  while (Date.now() - started < timeoutMs) {
    const res = await fetch(absoluteUrl, { headers });
    const data = await parseJsonSafe(res);
    lastData = data;
    if (res.status !== 202) {
      return { status: res.status, data };
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(delay * 1.5, 3200);
  }
  return { status: 202, data: lastData };
}

function extractUrlFromResponse(data: any): string | null {
  const nip94 = data?.nip94_event || data?.nip94;
  if (nip94 && Array.isArray(nip94.tags)) {
    const urlTag = (nip94.tags as unknown[]).find(
      (t): t is string[] => Array.isArray(t) && typeof t[0] === "string" && t[0] === "url" && typeof t[1] === "string",
    );
    if (urlTag && urlTag[1]?.trim()) {
      return urlTag[1].trim();
    }
  }
  if (typeof data?.url === "string" && data.url.trim()) {
    return data.url.trim();
  }
  return null;
}

export async function uploadAvatarToNip96(options: {
  serverUrl: string;
  file: Blob;
  filename?: string;
  contentType?: string;
  signer: string | Uint8Array;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<Nip96UploadResult> {
  const info = await discoverNip96Server(options.serverUrl);
  console.info("[nip96] Uploading avatar", { server: info.baseUrl, apiUrl: info.apiUrl });

  const uploadFile =
    options.file instanceof File
      ? options.file
      : new File([options.file], options.filename || "avatar", {
          type: options.contentType || options.file.type || "application/octet-stream",
        });
  const payloadHash = bytesToHex(sha256(new Uint8Array(await uploadFile.arrayBuffer())));
  const headers: HeadersInit = {
    Authorization: buildNip98AuthHeader(info.apiUrl, "POST", payloadHash, options.signer),
  };

  const form = new FormData();
  form.append("file", uploadFile);
  form.append("media_type", "avatar");
  form.append("content_type", options.contentType || uploadFile.type || "application/octet-stream");
  form.append("size", String(uploadFile.size));

  const res = await fetch(info.apiUrl, {
    method: "POST",
    headers,
    body: form,
    signal: options.signal,
  });

  let data = await parseJsonSafe(res);
  if (res.status === 202 && data?.processing_url) {
    const processingUrl = new URL(data.processing_url, info.apiUrl).toString();
    const poll = await pollProcessingUrl(processingUrl, headers, options.timeoutMs ?? 12000);
    data = poll.data ?? data;
    if (poll.status !== 200 && poll.status !== 201) {
      throw new Error(data?.message || "Upload is still processing, please try again.");
    }
  } else if (!res.ok) {
    throw new Error(data?.message || `Upload failed (${res.status})`);
  }

  const pictureUrl = extractUrlFromResponse(data);
  if (!pictureUrl) {
    throw new Error("Upload response did not include a file url.");
  }

  const nip94 = (data?.nip94_event || data?.nip94) as NostrEvent | null | undefined;
  console.info("[nip96] Upload complete", { url: pictureUrl });

  return {
    url: pictureUrl,
    nip94: nip94 ?? null,
    response: data,
    info,
  };
}

export async function uploadAvatarToBlossom(options: {
  serverUrl: string;
  file: Blob;
  filename?: string;
  contentType?: string;
  signer: string | Uint8Array;
  signal?: AbortSignal;
}): Promise<Nip96UploadResult> {
  const normalizedBase = normalizeFileServerUrl(options.serverUrl) || options.serverUrl;
  const uploadUrl = `${normalizedBase}/upload`;
  const mimeType = options.contentType || options.file.type || "application/octet-stream";
  const fileBytes = new Uint8Array(await options.file.arrayBuffer());
  const sha256hex = bytesToHex(sha256(fileBytes));

  console.info("[blossom] Uploading avatar", { server: normalizedBase });

  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": mimeType,
      "Content-Length": String(options.file.size),
      "X-SHA-256": sha256hex,
      Authorization: buildBlossomAuthHeader(sha256hex, options.signer),
    },
    body: options.file,
    signal: options.signal,
  });

  const data = await parseJsonSafe(res);

  if (!res.ok) {
    const reason = res.headers.get("X-Reason") || data?.message || `Upload failed (${res.status})`;
    throw new Error(reason);
  }

  const pictureUrl = typeof data?.url === "string" ? data.url.trim() : null;
  if (!pictureUrl) {
    throw new Error("Blossom upload response did not include a url.");
  }

  console.info("[blossom] Upload complete", { url: pictureUrl });

  return {
    url: pictureUrl,
    nip94: null,
    response: data,
    info: { baseUrl: normalizedBase, apiUrl: uploadUrl },
  };
}

export async function uploadAvatarToOriginless(options: {
  serverUrl: string;
  file: Blob;
  filename?: string;
  contentType?: string;
  signal?: AbortSignal;
}): Promise<Nip96UploadResult> {
  const normalizedBase = normalizeFileServerUrl(options.serverUrl) || options.serverUrl;
  const uploadUrl = `${normalizedBase}/upload`;

  console.info("[originless] Uploading avatar", { server: normalizedBase });

  const form = new FormData();
  const uploadBlob =
    options.file instanceof File
      ? options.file
      : new File([options.file], options.filename || "avatar", {
          type: options.contentType || options.file.type || "application/octet-stream",
        });
  form.append("file", uploadBlob);

  const res = await fetch(uploadUrl, {
    method: "POST",
    body: form,
    signal: options.signal,
  });

  const data = await parseJsonSafe(res);

  if (!res.ok) {
    throw new Error(data?.message || `Upload failed (${res.status})`);
  }

  const pictureUrl = typeof data?.url === "string" ? data.url.trim() : null;
  if (!pictureUrl) {
    throw new Error("Originless upload response did not include a url.");
  }

  console.info("[originless] Upload complete", { url: pictureUrl });

  return {
    url: pictureUrl,
    nip94: null,
    response: data,
    info: { baseUrl: normalizedBase, apiUrl: uploadUrl },
  };
}

export async function uploadAvatar(options: {
  serverEntry: FileServerEntry;
  file: Blob;
  filename?: string;
  contentType?: string;
  signer?: string | Uint8Array;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<Nip96UploadResult> {
  const { serverEntry } = options;
  switch (serverEntry.type) {
    case "blossom": {
      if (!options.signer) throw new Error("Blossom upload requires a signer.");
      return uploadAvatarToBlossom({
        serverUrl: serverEntry.url,
        file: options.file,
        filename: options.filename,
        contentType: options.contentType,
        signer: options.signer,
        signal: options.signal,
      });
    }
    case "originless": {
      return uploadAvatarToOriginless({
        serverUrl: serverEntry.url,
        file: options.file,
        filename: options.filename,
        contentType: options.contentType,
        signal: options.signal,
      });
    }
    case "nip96":
    default: {
      if (!options.signer) throw new Error("NIP-96 upload requires a signer.");
      return uploadAvatarToNip96({
        serverUrl: serverEntry.url,
        file: options.file,
        filename: options.filename,
        contentType: options.contentType,
        signer: options.signer,
        timeoutMs: options.timeoutMs,
        signal: options.signal,
      });
    }
  }
}
