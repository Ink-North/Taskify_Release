export const DEFAULT_FILE_STORAGE_SERVER = "https://nostr.build";

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
