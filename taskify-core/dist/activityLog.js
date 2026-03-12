export function createCommentEntry(input) {
    const entityId = input.entityId.trim();
    const actorPubkey = input.actorPubkey.trim();
    const text = input.text.trim();
    if (!entityId)
        throw new Error("entityId is required");
    if (!actorPubkey)
        throw new Error("actorPubkey is required");
    if (!text)
        throw new Error("comment text is required");
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
export function createActivityEntry(input) {
    const entityId = input.entityId.trim();
    const actorPubkey = input.actorPubkey.trim();
    if (!entityId)
        throw new Error("entityId is required");
    if (!actorPubkey)
        throw new Error("actorPubkey is required");
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
