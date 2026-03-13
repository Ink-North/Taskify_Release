import {
  mergeBackupBoards,
  normalizeRelayList,
  type NostrAppBackupBoard,
} from "taskify-core";
import type { BoardEntry } from "../config.js";

type ParsedBackupSnapshot = {
  boards: NostrAppBackupBoard[];
  settings: Record<string, unknown>;
  walletSeed: Record<string, unknown>;
  defaultRelays: string[];
};

type MergeBoardShape = {
  id: string;
  name: string;
  kind: "week" | "lists" | "compound" | "bible";
  nostr?: { boardId: string; relays: string[] };
  archived?: boolean;
  hidden?: boolean;
  clearCompletedDisabled?: boolean;
  indexCardEnabled?: boolean;
  hideChildBoardNames?: boolean;
  columns?: { id: string; name: string }[];
  children?: string[];
};

function fallbackRelayList(relays: string[] | undefined): string[] {
  return normalizeRelayList(relays) ?? [];
}

export function parseBackupSnapshot(raw: string): ParsedBackupSnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Invalid backup JSON");
  }

  const obj = (parsed ?? {}) as Record<string, unknown>;
  const boards = Array.isArray(obj.boards) ? (obj.boards as NostrAppBackupBoard[]) : [];
  const settings = obj.settings && typeof obj.settings === "object"
    ? (obj.settings as Record<string, unknown>)
    : {};
  const walletSeed = obj.walletSeed && typeof obj.walletSeed === "object"
    ? (obj.walletSeed as Record<string, unknown>)
    : {};
  const defaultRelays = normalizeRelayList(obj.defaultRelays) ?? [];

  return { boards, settings, walletSeed, defaultRelays };
}

export function mergeRelaysFromBackup(currentRelays: string[], backupDefaultRelays: string[]): string[] {
  const normalizedBackup = normalizeRelayList(backupDefaultRelays) ?? [];
  if (normalizedBackup.length > 0) return normalizedBackup;
  return normalizeRelayList(currentRelays) ?? [];
}

export function mergeBoardsFromBackup(
  currentBoards: BoardEntry[],
  incomingBoards: NostrAppBackupBoard[],
  defaultRelays: string[],
): BoardEntry[] {
  const current: MergeBoardShape[] = currentBoards.map((board) => ({
    id: board.id,
    name: board.name,
    kind: board.kind ?? "lists",
    nostr: {
      boardId: board.id,
      relays: fallbackRelayList(board.relays),
    },
    columns: board.columns,
    children: board.children,
  }));

  const merged = mergeBackupBoards<MergeBoardShape>({
    currentBoards: current,
    incomingBoards,
    baseRelays: fallbackRelayList(defaultRelays),
    normalizeRelayList: (relays) => fallbackRelayList(relays ?? undefined),
    createId: () => crypto.randomUUID(),
  });

  return merged.map((board) => ({
    id: board.id,
    name: board.name,
    kind: board.kind,
    relays: board.nostr?.relays,
    columns: board.columns,
    children: board.children,
  }));
}
