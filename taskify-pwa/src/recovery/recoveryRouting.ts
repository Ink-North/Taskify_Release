function getUrl(href?: string): URL | null {
  try {
    if (typeof window === "undefined") return null;
    return new URL(href ?? window.location.href);
  } catch {
    return null;
  }
}

export function isRecoveryUrl(): boolean {
  const url = getUrl();
  if (!url) return false;
  const param = (url.searchParams.get("recovery") || "").trim().toLowerCase();
  if (param && param !== "0" && param !== "false" && param !== "no") return true;
  const parts = url.pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] === "recovery";
}

export function buildRecoveryUrl(href?: string): string {
  const url = getUrl(href);
  if (!url) return href || "";
  url.searchParams.set("recovery", "1");
  return url.toString();
}

export function buildExitRecoveryUrl(href?: string): string {
  const url = getUrl(href);
  if (!url) return href || "";
  url.searchParams.delete("recovery");
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[parts.length - 1] === "recovery") {
    parts.pop();
    url.pathname = `/${parts.join("/")}`;
  }
  return url.toString();
}

export function replaceUrlForRecovery(): void {
  const url = getUrl();
  if (!url) return;
  url.searchParams.set("recovery", "1");
  try {
    window.history.replaceState({}, "", url.toString());
  } catch {
    // ignore history errors
  }
}
