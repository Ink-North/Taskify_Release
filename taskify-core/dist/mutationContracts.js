import { normalizeCalendarEventPayload } from "./calendarPayload.js";
export function normalizeCalendarMutationPayload(input, createdAtMs) {
    const normalized = normalizeCalendarEventPayload(input);
    if (!normalized)
        return null;
    return {
        ...normalized,
        createdAt: createdAtMs,
    };
}
export function normalizeCalendarDeleteMutationPayload(input, createdAtMs) {
    const normalized = normalizeCalendarEventPayload({ ...input, deleted: true });
    if (!normalized)
        return null;
    return {
        ...normalized,
        deleted: true,
        createdAt: createdAtMs,
    };
}
