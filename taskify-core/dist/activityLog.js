export function createCommentEntry(input) {
    const text = input.text.trim();
    if (!text)
        throw new Error("comment text is required");
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
export function createActivityEntry(input) {
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
