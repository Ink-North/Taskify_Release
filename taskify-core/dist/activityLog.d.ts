export type EntityType = "task" | "event";
export type SourceType = "cli" | "pwa" | "agent";
export type CommentInput = {
    entityType: EntityType;
    entityId: string;
    text: string;
    actorPubkey: string;
    source: SourceType;
    createdAt?: number;
};
export type ActivityChange = {
    field: string;
    from?: unknown;
    to?: unknown;
};
export type ActivityInput = {
    entityType: EntityType;
    entityId: string;
    action: "created" | "updated" | "deleted" | "status" | "assigned" | "moved";
    actorPubkey: string;
    source: SourceType;
    changes?: ActivityChange[];
    createdAt?: number;
};
export type CommentEntry = {
    id: string;
    type: "comment";
    entityType: EntityType;
    entityId: string;
    text: string;
    actorPubkey: string;
    source: SourceType;
    createdAt: number;
};
export type ActivityEntry = {
    id: string;
    type: "activity";
    entityType: EntityType;
    entityId: string;
    action: ActivityInput["action"];
    actorPubkey: string;
    source: SourceType;
    changes: ActivityChange[];
    createdAt: number;
};
export declare function createCommentEntry(input: CommentInput): CommentEntry;
export declare function createActivityEntry(input: ActivityInput): ActivityEntry;
