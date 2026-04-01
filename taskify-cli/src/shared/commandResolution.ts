import { resolveBoardReference } from "taskify-core";
import type { BoardEntry } from "../config.js";

export type BoardResolutionResult =
  | { ok: true; boardId: string }
  | { ok: false; exitCode: 1; message: string; listBoards?: boolean };

export function resolveBoardForCommand(boards: BoardEntry[], boardRef?: string): BoardResolutionResult {
  if (boardRef) {
    const entry = resolveBoardReference(boards, boardRef);
    if (!entry) return { ok: false, exitCode: 1, message: `Board not found: "${boardRef}".`, listBoards: true };
    return { ok: true, boardId: entry.id };
  }
  if (boards.length === 1) return { ok: true, boardId: boards[0].id };
  if (boards.length === 0) return { ok: false, exitCode: 1, message: "No boards configured. Use: taskify board join <id> --name <name>" };
  return { ok: false, exitCode: 1, message: "Multiple boards configured. Specify one with --board <id|name>:", listBoards: true };
}

export async function requireResolvedTask(runtime: { getTask(taskId: string, boardId?: string): Promise<unknown | null> }, taskId: string, boardId?: string): Promise<{ ok: true; value: unknown } | { ok: false; exitCode: 1; message: string }> {
  const value = await runtime.getTask(taskId, boardId);
  if (!value) return { ok: false, exitCode: 1, message: `Task not found: ${taskId}` };
  return { ok: true, value };
}

export async function requireResolvedEvent(runtime: { getEvent(eventId: string, boardId?: string): Promise<unknown | null> }, eventId: string, boardId?: string): Promise<{ ok: true; value: unknown } | { ok: false; exitCode: 1; message: string }> {
  const value = await runtime.getEvent(eventId, boardId);
  if (!value) return { ok: false, exitCode: 1, message: `Event not found: ${eventId}` };
  return { ok: true, value };
}
