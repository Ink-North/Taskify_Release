export const DEFAULT_FILE_STORAGE_SERVER = "https://nostr.build";

export type FileServerType = "nip96" | "blossom" | "originless";

export type FileServerEntry = {
  url: string;
  type: FileServerType;
  label?: string;
};

export const DEFAULT_FILE_SERVERS: FileServerEntry[] = [
  { url: "https://nostr.build", type: "nip96", label: "nostr.build" },
  { url: "https://originless.besoeasy.com", type: "originless", label: "originless.besoeasy.com" },
  { url: "https://blossom.band", type: "blossom", label: "blossom.band" },
];

export function parseFileServers(raw: string | null | undefined): FileServerEntry[] {
  if (!raw) return DEFAULT_FILE_SERVERS.slice();
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_FILE_SERVERS.slice();
    const valid = parsed.filter(
      (e): e is FileServerEntry =>
        e &&
        typeof e === "object" &&
        typeof e.url === "string" &&
        e.url.trim() !== "" &&
        (e.type === "nip96" || e.type === "blossom" || e.type === "originless"),
    );
    return valid.length ? valid : DEFAULT_FILE_SERVERS.slice();
  } catch {
    return DEFAULT_FILE_SERVERS.slice();
  }
}

export function serializeFileServers(servers: FileServerEntry[]): string {
  return JSON.stringify(servers);
}

export function findServerEntry(
  servers: FileServerEntry[],
  url: string,
): FileServerEntry | undefined {
  const normalized = normalizeFileServerUrl(url) || url;
  return servers.find((e) => {
    const entryNorm = normalizeFileServerUrl(e.url) || e.url;
    return entryNorm === normalized;
  });
}

function trimTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.replace(/\/+$/, "") : url;
}

export function normalizeFileServerUrl(value: string | null | undefined): string {
  const raw = (value || "").trim();
  if (!raw) return "";

  const tryBuild = (input: string): string | null => {
    try {
      const parsed = new URL(input);
      if (!parsed.protocol || parsed.protocol === ":") {
        return null;
      }
      const base = `${parsed.protocol}//${parsed.host}`;
      const path = parsed.pathname ? trimTrailingSlash(parsed.pathname) : "";
      return `${base}${path}`;
    } catch {
      return null;
    }
  };

  return tryBuild(raw) ?? tryBuild(`https://${raw}`) ?? "";
}
