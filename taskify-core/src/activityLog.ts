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

export function createCommentEntry(input: CommentInput): CommentEntry {
  const entityId = input.entityId.trim();
  const actorPubkey = input.actorPubkey.trim();
  const text = input.text.trim();

  if (!entityId) throw new Error("entityId is required");
  if (!actorPubkey) throw new Error("actorPubkey is required");
  if (!text) throw new Error("comment text is required");

  return {
    id: crypto.randomUUID(),
    type: "comment",
    entityType: input.entityType,
    entityId,
    text,
    actorPubkey,
    source: input.source,
    createdAt: input.createdAt ?? Date.now(),
  };
}

export function createActivityEntry(input: ActivityInput): ActivityEntry {
  const entityId = input.entityId.trim();
  const actorPubkey = input.actorPubkey.trim();
  if (!entityId) throw new Error("entityId is required");
  if (!actorPubkey) throw new Error("actorPubkey is required");

  const changes = (input.changes ?? [])
    .map((change) => ({ ...change, field: change.field.trim() }))
    .filter((change) => !!change.field);

  return {
    id: crypto.randomUUID(),
    type: "activity",
    entityType: input.entityType,
    entityId,
    action: input.action,
    actorPubkey,
    source: input.source,
    changes,
    createdAt: input.createdAt ?? Date.now(),
  };
}
