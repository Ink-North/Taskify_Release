export type SharedBoardPayload = {
    type: "board";
    boardId: string;
    boardName?: string;
    relays?: string[];
};
export type SharedContactPayload = {
    type: "contact";
    npub: string;
    name?: string;
    displayName?: string;
    username?: string;
    nip05?: string;
    lud16?: string;
    relays?: string[];
    about?: string;
    picture?: string;
    sender?: {
        npub?: string;
        name?: string;
    };
};
export type SharedTaskPayload = {
    type: "task";
    title: string;
    note?: string;
    priority?: number;
    dueISO?: string;
    dueDateEnabled?: boolean;
    dueTimeEnabled?: boolean;
    dueTimeZone?: string;
    reminders?: Array<string | number>;
    subtasks?: {
        title: string;
        completed?: boolean;
    }[];
    recurrence?: {
        type: string;
        [key: string]: unknown;
    };
    assignees?: Array<{
        pubkey: string;
        relay?: string;
        status?: "pending" | "accepted" | "declined" | "tentative";
        respondedAt?: number;
    }>;
    sourceTaskId?: string;
    assignment?: boolean;
    relays?: string[];
};
export type SharedCalendarEventInvitePayload = {
    type: "event";
    eventId: string;
    canonical: string;
    view: string;
    eventKey: string;
    inviteToken: string;
    title?: string;
    start?: string;
    end?: string;
    relays?: string[];
};
export type SharedTaskAssignmentResponsePayload = {
    type: "task-assignment-response";
    taskId: string;
    status: "accepted" | "declined" | "tentative";
    respondedAt?: string;
};
export type ShareEnvelope = {
    v: 1;
    kind: "taskify-share";
    item: SharedBoardPayload | SharedContactPayload | SharedTaskPayload | SharedCalendarEventInvitePayload | SharedTaskAssignmentResponsePayload;
    sender?: {
        npub?: string;
        name?: string;
    };
};
export declare function buildBoardShareEnvelope(boardId: string, boardName?: string, relays?: string[], sender?: {
    npub?: string;
    name?: string;
}): ShareEnvelope;
export declare function buildContactShareEnvelope(payload: SharedContactPayload): ShareEnvelope;
export declare function buildTaskShareEnvelope(payload: SharedTaskPayload, sender?: {
    npub?: string;
    name?: string;
}): ShareEnvelope;
export declare function buildTaskAssignmentResponseEnvelope(payload: Omit<SharedTaskAssignmentResponsePayload, "type">, sender?: {
    npub?: string;
    name?: string;
}): ShareEnvelope;
export declare function buildCalendarEventInviteEnvelope(payload: Omit<SharedCalendarEventInvitePayload, "type">, sender?: {
    npub?: string;
    name?: string;
}): ShareEnvelope;
export declare function parseShareEnvelope(raw: string): ShareEnvelope | null;
