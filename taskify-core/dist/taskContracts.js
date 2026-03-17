export const TASK_PRIORITY_MARKS = {
    1: "!",
    2: "!!",
    3: "!!!",
};
export function isExternalCalendarEvent(event) { return event.external === true; }
export function isListLikeBoard(board) {
    return !!board && (board.kind === "lists" || board.kind === "compound");
}
