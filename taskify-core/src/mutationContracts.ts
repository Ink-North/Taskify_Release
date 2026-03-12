import { normalizeCalendarEventPayload, type CalendarNormalizedPayload } from "./calendarPayload.js";

export type CalendarMutationInput = {
  title?: string;
  kind?: "date" | "time";
  startDate?: string;
  endDate?: string;
  startISO?: string;
  endISO?: string;
  startTzid?: string;
  endTzid?: string;
  description?: string;
};

export type CalendarMutationResult = CalendarNormalizedPayload & {
  createdAt: number;
};

export function normalizeCalendarMutationPayload(
  input: CalendarMutationInput,
  createdAtMs: number,
): CalendarMutationResult | null {
  const normalized = normalizeCalendarEventPayload(input);
  if (!normalized) return null;
  return {
    ...normalized,
    createdAt: createdAtMs,
  };
}
