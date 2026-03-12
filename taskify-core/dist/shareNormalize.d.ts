export type BoardSharePayload = {
    boardId: string;
    boardName?: string;
    relaysCsv?: string;
};
export declare function normalizeCalendarAddress(value: unknown, allowedKinds: number[]): string | null;
export declare function parseBoardSharePayload(raw: string): BoardSharePayload | null;
