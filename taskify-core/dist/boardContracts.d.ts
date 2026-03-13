import type { Board } from "./taskContracts.js";
export type BoardReferenceLike = {
    id: string;
    name?: string | null;
};
export declare function resolveBoardReference<TBoard extends BoardReferenceLike>(boards: TBoard[], boardRef: string): TBoard | null;
export declare function parseCompoundChildInput(raw: string): {
    boardId: string;
    relays: string[];
};
export declare function findBoardByCompoundChildId(boards: Board[], childId: string): Board | undefined;
export declare function compoundChildMatchesBoard(childId: string, board: Board): boolean;
export declare function normalizeCompoundChildId(boards: Board[], childId: string): string;
export declare function boardScopeIds(board: Board, boards: Board[]): string[];
