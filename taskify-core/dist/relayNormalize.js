export function normalizeRelayList(value) {
    if (!Array.isArray(value))
        return undefined;
    const relays = value
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter(Boolean);
    return relays.length ? Array.from(new Set(relays)) : undefined;
}
