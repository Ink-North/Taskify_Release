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
