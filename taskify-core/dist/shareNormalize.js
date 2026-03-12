import { parseCalendarAddress } from "./calendarProtocol.js";
export function normalizeCalendarAddress(value, allowedKinds) {
    if (typeof value !== "string")
        return null;
    const parsed = parseCalendarAddress(value);
    if (!parsed)
        return null;
    if (!allowedKinds.includes(parsed.kind))
        return null;
    return `${parsed.kind}:${parsed.pubkey}:${parsed.d}`;
}
