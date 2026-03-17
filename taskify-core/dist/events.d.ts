export type CalendarEvent = {
    id: string;
    boardId: string;
    title: string;
    kind: "date";
    startDate: string;
    endDate?: string;
} | {
    id: string;
    boardId: string;
    title: string;
    kind: "time";
    startISO: string;
    endISO?: string;
    startTzid?: string;
    endTzid?: string;
};
export type BuildCalendarEventDraftInput = {
    boardId: string;
    title: string;
    date: string;
    endDate?: string;
    time?: string;
    endTime?: string;
    timeZone?: string;
};
export declare function buildCalendarEventDraft(input: BuildCalendarEventDraftInput): CalendarEvent;
