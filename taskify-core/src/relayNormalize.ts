export function normalizeRelayList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const relays = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
  return relays.length ? Array.from(new Set(relays)) : undefined;
}

export function normalizeRelayListSorted(value: unknown): string[] | undefined {
  const normalized = normalizeRelayList(value);
  if (!normalized?.length) return undefined;
  return [...normalized].sort();
}
