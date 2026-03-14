import test from "node:test";
import assert from "node:assert/strict";
import { parseCompoundChildInput, boardScopeIds, normalizeCompoundChildId, resolveBoardReference } from "../dist/boardContracts.js";

test("parseCompoundChildInput parses board and relays", () => {
  const out = parseCompoundChildInput("child@wss://a,wss://b");
  assert.equal(out.boardId, "child");
  assert.equal(out.relays.length, 2);
});

test("boardScopeIds includes ids and child ids", () => {
  const boards = [
    { id: "p", name: "P", kind: "compound", children: ["c"], nostr: { boardId: "np", relays: [] } },
    { id: "c", name: "C", kind: "week", nostr: { boardId: "nc", relays: [] } },
  ];
  const ids = boardScopeIds(boards[0] as any, boards as any);
  assert.equal(ids.includes("p"), true);
  assert.equal(ids.includes("c"), true);
  assert.equal(normalizeCompoundChildId(boards as any, "nc"), "c");
});

test("resolveBoardReference matches by id or case-insensitive name", () => {
  const boards = [
    { id: "board-1", name: "Personal" },
    { id: "board-2", name: "Work" },
  ];
  assert.equal(resolveBoardReference(boards, "board-2")?.id, "board-2");
  assert.equal(resolveBoardReference(boards, "personal")?.id, "board-1");
  assert.equal(resolveBoardReference(boards, "") , null);
  assert.equal(resolveBoardReference(boards, "missing"), null);
});
