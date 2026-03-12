export declare const TASKIFY_CALENDAR_EVENT_KIND = 30310;
export declare const TASKIFY_CALENDAR_VIEW_KIND = 30311;
export declare const TASKIFY_CALENDAR_RSVP_KIND = 30312;
export type CalendarAddress = {
    kind: number;
    pubkey: string;
    d: string;
};
export declare function calendarAddress(kind: number, pubkey: string, d: string): string;
export declare function parseCalendarAddress(coord: string): CalendarAddress | null;
