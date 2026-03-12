type EntityType = "task" | "event";
type SourceType = "cli" | "pwa" | "agent";

type CommentInput = {
  entityType: EntityType;
  entityId: string;
  text: string;
  actorPubkey: string;
  source: SourceType;
  createdAt?: number;
};

type ActivityChange = {
  field: string;
  from?: unknown;
  to?: unknown;
};

type ActivityInput = {
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

export function createCommentEntry(input: CommentInput): CommentEntry {
  const text = input.text.trim();
  if (!text) throw new Error("comment text is required");
  return {
    id: crypto.randomUUID(),
    type: "comment",
    entityType: input.entityType,
    entityId: input.entityId,
    text,
    actorPubkey: input.actorPubkey,
    source: input.source,
    createdAt: input.createdAt ?? Date.now(),
  };
}

export function createActivityEntry(input: ActivityInput): ActivityEntry {
  return {
    id: crypto.randomUUID(),
    type: "activity",
    entityType: input.entityType,
    entityId: input.entityId,
    action: input.action,
    actorPubkey: input.actorPubkey,
    source: input.source,
    changes: input.changes ?? [],
    createdAt: input.createdAt ?? Date.now(),
  };
}
