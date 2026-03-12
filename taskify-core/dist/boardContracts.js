export function parseCompoundChildInput(raw) {
    const trimmed = raw.trim();
    if (!trimmed)
        return { boardId: "", relays: [] };
    let boardId = trimmed;
    let relaySegment = "";
    const atIndex = trimmed.indexOf("@");
    if (atIndex >= 0) {
        boardId = trimmed.slice(0, atIndex).trim();
        relaySegment = trimmed.slice(atIndex + 1).trim();
    }
    else {
        const spaceIndex = trimmed.search(/\s/);
        if (spaceIndex >= 0) {
            boardId = trimmed.slice(0, spaceIndex).trim();
            relaySegment = trimmed.slice(spaceIndex + 1).trim();
        }
    }
    const relays = relaySegment ? relaySegment.split(/[\s,]+/).map((relay) => relay.trim()).filter(Boolean) : [];
    return { boardId, relays };
}
export function findBoardByCompoundChildId(boards, childId) {
    return boards.find((board) => board.id === childId || (!!board.nostr?.boardId && board.nostr.boardId === childId));
}
export function compoundChildMatchesBoard(childId, board) {
    return childId === board.id || (!!board.nostr?.boardId && childId === board.nostr.boardId);
}
export function normalizeCompoundChildId(boards, childId) {
    const match = findBoardByCompoundChildId(boards, childId);
    return match ? match.id : childId;
}
export function boardScopeIds(board, boards) {
    const ids = new Set();
    const addId = (value) => {
        if (typeof value === "string" && value)
            ids.add(value);
    };
    const addBoard = (target) => {
        if (!target)
            return;
        addId(target.id);
        addId(target.nostr?.boardId);
    };
    addBoard(board);
    if (board.kind === "compound") {
        board.children.forEach((childId) => {
            addId(childId);
            addBoard(findBoardByCompoundChildId(boards, childId));
        });
    }
    return Array.from(ids);
}
