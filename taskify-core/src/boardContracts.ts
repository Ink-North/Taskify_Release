import type { Board } from "./taskContracts.js";

export type BoardReferenceLike = { id: string; name?: string | null };

export function resolveBoardReference<TBoard extends BoardReferenceLike>(boards: TBoard[], boardRef: string): TBoard | null {
  const ref = boardRef.trim();
  if (!ref) return null;
  const exact = boards.find((board) => board.id === ref);
  if (exact) return exact;
  const lower = ref.toLowerCase();
  return boards.find((board) => (board.name ?? "").toLowerCase() === lower) ?? null;
}

export function parseCompoundChildInput(raw: string): { boardId: string; relays: string[] } {
  const trimmed = raw.trim();
  if (!trimmed) return { boardId: "", relays: [] };
  let boardId = trimmed;
  let relaySegment = "";
  const atIndex = trimmed.indexOf("@");
  if (atIndex >= 0) {
    boardId = trimmed.slice(0, atIndex).trim();
    relaySegment = trimmed.slice(atIndex + 1).trim();
  } else {
    const spaceIndex = trimmed.search(/\s/);
    if (spaceIndex >= 0) {
      boardId = trimmed.slice(0, spaceIndex).trim();
      relaySegment = trimmed.slice(spaceIndex + 1).trim();
    }
  }
  const relays = relaySegment ? relaySegment.split(/[\s,]+/).map((relay) => relay.trim()).filter(Boolean) : [];
  return { boardId, relays };
}

export function findBoardByCompoundChildId(boards: Board[], childId: string): Board | undefined {
  return boards.find((board) => board.id === childId || (!!board.nostr?.boardId && board.nostr.boardId === childId));
}

export function compoundChildMatchesBoard(childId: string, board: Board): boolean {
  return childId === board.id || (!!board.nostr?.boardId && childId === board.nostr.boardId);
}

export function normalizeCompoundChildId(boards: Board[], childId: string): string {
  const match = findBoardByCompoundChildId(boards, childId);
  return match ? match.id : childId;
}

export function boardScopeIds(board: Board, boards: Board[]): string[] {
  const ids = new Set<string>();
  const addId = (value?: string | null) => {
    if (typeof value === "string" && value) ids.add(value);
  };
  const addBoard = (target: Board | undefined) => {
    if (!target) return;
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
