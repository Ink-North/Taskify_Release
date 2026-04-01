export function resolveIdentifierReference(entries, ref) {
    const normalized = ref.trim().toLowerCase();
    if (!normalized)
        return null;
    const exact = entries.find((entry) => entry.id.toLowerCase() === normalized);
    if (exact)
        return exact;
    if (normalized.length >= 4) {
        const matches = entries.filter((entry) => entry.id.toLowerCase().startsWith(normalized));
        if (matches.length === 1)
            return matches[0];
    }
    return null;
}
export function readTagValue(tags, tagName) {
    const found = tags.find((tag) => tag[0] === tagName);
    const value = found?.[1];
    return typeof value === "string" && value.length > 0 ? value : undefined;
}
export function readStatusTag(tags, fallback) {
    return readTagValue(tags, "status") ?? fallback;
}
