function normalizeString(value) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
}
function normalizeStringArray(value) {
    if (!Array.isArray(value))
        return undefined;
    const out = value
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter(Boolean);
    return out.length ? out : undefined;
}
export function normalizeDelimitedValues(raw, delimiter, options) {
    const values = (raw || "")
        .split(delimiter)
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => {
        if (options?.stripPrefix && value.startsWith(options.stripPrefix)) {
            return value.slice(options.stripPrefix.length);
        }
        return value;
    })
        .filter(Boolean);
    if (!values.length)
        return undefined;
    if (options?.dedupe === false)
        return values;
    return Array.from(new Set(values));
}
export function normalizeLocationList(list) {
    const out = (list || []).map((value) => value.trim()).filter(Boolean);
    return out.length ? out : undefined;
}
export function normalizeCalendarEventPayload(raw) {
    if (!raw || typeof raw !== "object")
        return null;
    const deleted = raw.deleted === true;
    const kindRaw = raw.kind;
    const kind = kindRaw === "date" || kindRaw === "time" ? kindRaw : undefined;
    const title = normalizeString(raw.title);
    if (!deleted && !title)
        return null;
    const payload = {
        ...(deleted ? { deleted: true } : {}),
        ...(kind ? { kind } : {}),
        ...(title ? { title } : {}),
    };
    const summary = normalizeString(raw.summary);
    if (summary)
        payload.summary = summary;
    const description = normalizeString(raw.description);
    if (description)
        payload.description = description;
    const startDate = normalizeString(raw.startDate);
    if (startDate)
        payload.startDate = startDate;
    const endDate = normalizeString(raw.endDate);
    if (endDate)
        payload.endDate = endDate;
    const startISO = normalizeString(raw.startISO);
    if (startISO)
        payload.startISO = startISO;
    const endISO = normalizeString(raw.endISO);
    if (endISO)
        payload.endISO = endISO;
    const startTzid = normalizeString(raw.startTzid);
    if (startTzid)
        payload.startTzid = startTzid;
    const endTzid = normalizeString(raw.endTzid);
    if (endTzid)
        payload.endTzid = endTzid;
    const locations = normalizeStringArray(raw.locations);
    if (locations)
        payload.locations = locations;
    const hashtags = normalizeStringArray(raw.hashtags);
    if (hashtags)
        payload.hashtags = hashtags;
    const references = normalizeStringArray(raw.references);
    if (references)
        payload.references = references;
    if (!deleted) {
        if (payload.kind === "date" && !payload.startDate)
            return null;
        if (payload.kind === "time" && !payload.startISO)
            return null;
    }
    // PWA-aligned range guards
    if (payload.kind === "date" && payload.startDate && payload.endDate && payload.endDate <= payload.startDate) {
        delete payload.endDate;
    }
    if (payload.kind === "time" && payload.startISO && payload.endISO) {
        const startMs = Date.parse(payload.startISO);
        const endMs = Date.parse(payload.endISO);
        if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) {
            delete payload.endISO;
        }
    }
    return payload;
}
