import { useState, useEffect } from "react";
import type { Task, Board } from "./taskTypes";
import { idbKeyValue } from "../../storage/idbKeyValue";
import { TASKIFY_STORE_TASKS } from "../../storage/taskifyDb";
import { LS_TASKS, LS_BOARDS } from "../storageKeys";
import { migrateBoards } from "./boardUtils";
import { dedupeRecurringInstances, normalizeTaskBounty, normalizeHiddenForRecurring, normalizeTaskPriority, normalizeTaskCreatedAt, PINNED_BOUNTY_LIST_KEY } from "./taskUtils";
import { normalizeDocumentList, ensureDocumentPreview } from "../../lib/documents";
import { sanitizeReminderList, normalizeReminderTime } from "../dateTime/reminderUtils";
import { normalizeTimeZone } from "../dateTime/dateUtils";

function useBoards() {
  const [boards, setBoards] = useState<Board[]>(() => {
    const raw = idbKeyValue.getItem(TASKIFY_STORE_TASKS, LS_BOARDS);
    if (raw) {
      const migrated = migrateBoards(JSON.parse(raw));
      if (migrated && migrated.length) return migrated;
    }
    // default: one Week board
    return [{ id: "week-default", name: "Week", kind: "week", archived: false, hidden: false, clearCompletedDisabled: false }];
  });
  useEffect(() => {
    idbKeyValue.setItem(TASKIFY_STORE_TASKS, LS_BOARDS, JSON.stringify(boards));
  }, [boards]);
  return [boards, setBoards] as const;
}

function useTasks() {
  const [tasks, setTasks] = useState<Task[]>(() => {
    const loadStored = (): any[] => {
      try {
        const current = idbKeyValue.getItem(TASKIFY_STORE_TASKS, LS_TASKS);
        if (current) {
          const parsed = JSON.parse(current);
          if (Array.isArray(parsed)) return parsed;
        }
      } catch {}
      return [];
    };

    const rawTasks = loadStored();
    const orderMap = new Map<string, number>();
    const createdAtFallback = Date.now();
    const normalized = rawTasks
      .map((entry, index) => {
        if (!entry || typeof entry !== 'object') return null;
        const fallbackBoard = typeof (entry as any).boardId === 'string' ? (entry as any).boardId : 'week-default';
        const boardId = fallbackBoard;
        const next = orderMap.get(boardId) ?? 0;
        const explicitOrder = typeof (entry as any).order === 'number' ? (entry as any).order : next;
        orderMap.set(boardId, explicitOrder + 1);
        const dueISO = typeof (entry as any).dueISO === 'string' ? (entry as any).dueISO : new Date().toISOString();
        const dueDateEnabled = typeof (entry as any).dueDateEnabled === 'boolean'
          ? (entry as any).dueDateEnabled
          : undefined;
        const dueTimeEnabled = typeof (entry as any).dueTimeEnabled === 'boolean' ? (entry as any).dueTimeEnabled : undefined;
        const dueTimeZoneRaw = typeof (entry as any).dueTimeZone === "string" ? (entry as any).dueTimeZone : undefined;
        const dueTimeZone = normalizeTimeZone(dueTimeZoneRaw) ?? undefined;
        const priority = normalizeTaskPriority((entry as any).priority);
        const createdAt = normalizeTaskCreatedAt((entry as any).createdAt) ?? (createdAtFallback + index);
        const reminders = sanitizeReminderList((entry as any).reminders);
        const reminderTime = normalizeReminderTime((entry as any).reminderTime);
        const id = typeof (entry as any).id === 'string' ? (entry as any).id : crypto.randomUUID();
        const scriptureMemoryId = typeof (entry as any).scriptureMemoryId === 'string'
          ? (entry as any).scriptureMemoryId
          : undefined;
        const scriptureMemoryStageRaw = Number((entry as any).scriptureMemoryStage);
        const scriptureMemoryStage = Number.isFinite(scriptureMemoryStageRaw) && scriptureMemoryStageRaw >= 0
          ? Math.floor(scriptureMemoryStageRaw)
          : undefined;
        const prevReviewRaw = (entry as any).scriptureMemoryPrevReviewISO;
        const scriptureMemoryPrevReviewISO =
          typeof prevReviewRaw === 'string'
            ? prevReviewRaw
            : prevReviewRaw === null
              ? null
              : undefined;
        const scriptureMemoryScheduledAt = typeof (entry as any).scriptureMemoryScheduledAt === 'string'
          ? (entry as any).scriptureMemoryScheduledAt
          : undefined;
        const documents = normalizeDocumentList((entry as any).documents);
        const task: Task = {
          ...(entry as Task),
          id,
          boardId,
          order: explicitOrder,
          dueISO,
          priority,
          createdAt,
          ...(typeof dueDateEnabled === 'boolean' ? { dueDateEnabled } : {}),
          ...(typeof dueTimeEnabled === 'boolean' ? { dueTimeEnabled } : {}),
          ...(dueTimeZone ? { dueTimeZone } : {}),
          ...(reminders !== undefined ? { reminders } : {}),
          ...(reminderTime ? { reminderTime } : {}),
          ...(scriptureMemoryId ? { scriptureMemoryId } : {}),
          ...(scriptureMemoryStage !== undefined ? { scriptureMemoryStage } : {}),
          ...(scriptureMemoryPrevReviewISO !== undefined ? { scriptureMemoryPrevReviewISO } : {}),
          ...(scriptureMemoryScheduledAt ? { scriptureMemoryScheduledAt } : {}),
        } as Task;
        if (documents) {
          task.documents = documents.map(ensureDocumentPreview);
        } else if (Object.prototype.hasOwnProperty.call(entry as any, "documents")) {
          task.documents = undefined;
        }

        const rawBountyLists = (entry as any).bountyLists;
        const bountyListSet = new Set<string>();
        if (Array.isArray(rawBountyLists)) {
          const normalizedLists = rawBountyLists
            .map((value) => (typeof value === "string" ? value.trim() : ""))
            .filter((value): value is string => value.length > 0);
          const unique = Array.from(new Set(normalizedLists));
          if (unique.length > 0) {
            unique.forEach((value) => bountyListSet.add(value));
            // Legacy bounties list choices map to the unified pinned list.
            bountyListSet.add(PINNED_BOUNTY_LIST_KEY);
          }
        }
        if ((entry as any).column === "bounties") {
          task.column = "day";
          bountyListSet.add(PINNED_BOUNTY_LIST_KEY);
        }
        if (bountyListSet.size > 0) {
          task.bountyLists = Array.from(bountyListSet);
        }

        return normalizeTaskBounty(normalizeHiddenForRecurring(task));
      })
      .filter((t): t is Task => !!t);
    return dedupeRecurringInstances(normalized);
  });
  useEffect(() => {
    try {
      idbKeyValue.setItem(TASKIFY_STORE_TASKS, LS_TASKS, JSON.stringify(tasks));
    } catch (err) {
      console.error('Failed to save tasks', err);
    }
  }, [tasks]);
  return [tasks, setTasks] as const;
}

export { useBoards, useTasks };
