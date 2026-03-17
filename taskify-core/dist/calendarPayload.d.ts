export type CalendarNormalizedPayload = {
    kind?: "date" | "time";
    title?: string;
    summary?: string;
    description?: string;
    startDate?: string;
    endDate?: string;
    startISO?: string;
    endISO?: string;
    startTzid?: string;
    endTzid?: string;
    locations?: string[];
    hashtags?: string[];
    references?: string[];
    deleted?: boolean;
};
export declare function normalizeDelimitedValues(raw: string, delimiter: RegExp, options?: {
    stripPrefix?: string;
    dedupe?: boolean;
}): string[] | undefined;
export declare function normalizeLocationList(list: string[]): string[] | undefined;
export declare function normalizeCalendarEventPayload(raw: unknown): CalendarNormalizedPayload | null;
