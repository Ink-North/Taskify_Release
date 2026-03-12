import type { TaskDocument } from "../../lib/documents";
import type { CalendarRsvpFb, CalendarRsvpStatus } from "../../lib/privateCalendar";
import type { SharedContactPayload, SharedTaskPayload } from "../../lib/shareInbox";

// ---- Priority ----

export type TaskPriority = 1 | 2 | 3;

export const TASK_PRIORITY_MARKS: Record<TaskPriority, string> = {
  1: "!",
  2: "!!",
  3: "!!!",
};

// ---- Recurrence ----

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0=Sun

export type Recurrence =
  | { type: "none"; untilISO?: string }
  | { type: "daily"; untilISO?: string }
  | { type: "weekly"; days: Weekday[]; untilISO?: string }
  | { type: "every"; n: number; unit: "hour" | "day" | "week"; untilISO?: string }
  | { type: "monthlyDay"; day: number; interval?: number; untilISO?: string };

// ---- Subtask ----

export type Subtask = {
  id: string;
  title: string;
  completed?: boolean;
};

// ---- Reminders ----

export type BuiltinReminderPreset = "0h" | "5m" | "15m" | "30m" | "1h" | "1d" | "1w" | "0d";
export type CustomReminderPreset = `custom-${number}`;
export type ReminderPreset = BuiltinReminderPreset | CustomReminderPreset;

// ---- Inbox ----

export type InboxSender = {
  pubkey: string;
  name?: string;
  npub?: string;
};

export type InboxItemStatus =
  | "pending"
  | "accepted"
  | "declined"
  | "tentative"
  | "deleted"
  | "read";

export type InboxItem =
  | {
      type: "board";
      boardId: string;
      boardName?: string;
      relays?: string[];
      sender: InboxSender;
      receivedAt: string;
      status?: InboxItemStatus;
      dmEventId?: string;
    }
  | {
      type: "contact";
      contact: SharedContactPayload;
      sender: InboxSender;
      receivedAt: string;
      status?: InboxItemStatus;
      dmEventId?: string;
    }
  | {
      type: "task";
      task: SharedTaskPayload;
      sender: InboxSender;
      receivedAt: string;
      status?: InboxItemStatus;
      dmEventId?: string;
    };

export type TaskAssigneeStatus = "pending" | "accepted" | "declined" | "tentative";

export type TaskAssignee = {
  pubkey: string;
  relay?: string;
  status?: TaskAssigneeStatus;
  respondedAt?: number;
};

// ---- Task ----

export type Task = {
  id: string;
  boardId: string;
  createdBy?: string;             // nostr pubkey of task creator
  lastEditedBy?: string;          // nostr pubkey of latest task editor
  createdAt?: number;             // unix ms timestamp (local)
  updatedAt?: string;             // iso timestamp of latest local edit when known
  title: string;
  priority?: TaskPriority;        // 1-3 exclamation marks
  note?: string;
  images?: string[];              // base64 data URLs for pasted images
  documents?: TaskDocument[];     // supported document attachments
  dueISO: string;                 // for week board day grouping
  dueDateEnabled?: boolean;       // whether the due date is active
  completed?: boolean;
  completedAt?: string;
  completedBy?: string;           // nostr pubkey of user who marked complete
  recurrence?: Recurrence;
  // Week board columns:
  column?: "day";
  // Custom boards (multi-list):
  columnId?: string;
  hiddenUntilISO?: string;        // controls visibility (appear at/after this date)
  order?: number;                 // order within the board for manual reordering
  streak?: number;                // consecutive completion count
  longestStreak?: number;         // highest recorded streak for the series
  seriesId?: string;              // identifier for a recurring series
  subtasks?: Subtask[];           // optional list of subtasks
  assignees?: TaskAssignee[];     // optional assignment list with response states
  bounty?: {
    id: string;                   // bounty id (uuid)
    token: string;                // cashu token string (locked or unlocked)
    amount?: number;              // optional, sats
    mint?: string;                // optional hint
    lock?: "p2pk" | "htlc" | "none" | "unknown";
    owner?: string;               // hex pubkey of task creator (who can unlock)
    sender?: string;              // hex pubkey of funder (who can revoke)
    receiver?: string;            // hex pubkey of intended recipient (who can decrypt nip04)
    state: "locked" | "unlocked" | "revoked" | "claimed";
    updatedAt: string;            // iso
    enc?:
      | {                         // optional encrypted form (hidden until funder reveals)
          alg: "aes-gcm-256";
          iv: string;            // base64
          ct: string;            // base64
        }
      | {
          alg: "nip04";         // encrypted to receiver's nostr pubkey (nip04 format)
          data: string;          // ciphertext returned by nip04.encrypt
      }
      | null;
  };
  dueTimeEnabled?: boolean;       // whether a specific due time is set
  dueTimeZone?: string;           // IANA time zone for due time (defaults to device zone)
  reminders?: ReminderPreset[];   // preset reminder offsets before due time
  reminderTime?: string;          // HH:mm reminder clock used when due time is not set
  scriptureMemoryId?: string;     // reference to scripture memory entry when auto-created
  scriptureMemoryStage?: number;  // stage at time of scheduling (for undo)
  scriptureMemoryPrevReviewISO?: string | null; // previous review timestamp snapshot
  scriptureMemoryScheduledAt?: string; // when this memory task was generated
  bountyLists?: string[];         // local-only set of bounty list keys the task belongs to
  bountyDeletedAt?: string;       // local-only marker for recoverable bounty-task deletes
  inboxItem?: InboxItem;          // shared inbox metadata (boards/contacts/tasks)
};

// ---- Calendar event types ----

export type CalendarEventParticipant = {
  pubkey: string;
  relay?: string;
  role?: string;
};

export type CalendarEventBase = {
  id: string;                     // stable event identifier
  boardId: string;
  createdBy?: string;             // nostr pubkey of event creator
  lastEditedBy?: string;          // nostr pubkey of latest event editor
  columnId?: string;              // list boards only
  order?: number;                 // manual ordering within board/column
  title: string;
  summary?: string;
  description?: string;
  documents?: TaskDocument[];     // supported document attachments
  image?: string;
  locations?: string[];
  geohash?: string;
  participants?: CalendarEventParticipant[];
  hashtags?: string[];
  references?: string[];
  reminders?: ReminderPreset[];   // per-device push reminders (not published)
  reminderTime?: string;          // HH:mm reminder clock used for all-day events
  hiddenUntilISO?: string;        // local visibility gating for board lists
  recurrence?: Recurrence;        // client-managed recurrence
  seriesId?: string;              // client-managed recurrence grouping
  readOnly?: boolean;             // view-only event (cannot publish edits)
  external?: boolean;             // boardless invitee event
  originBoardId?: string;         // board id to publish edits/deletions when different from boardId
  eventKey?: string;              // per-event share key (base64)
  inviteTokens?: Record<string, string>; // board-only invite tokens keyed by pubkey
  canonicalAddress?: string;      // canonical event address for invitees
  viewAddress?: string;           // shareable view address for invitees
  inviteToken?: string;           // invitee token for RSVP
  inviteRelays?: string[];        // relays to fetch view + RSVP
  boardPubkey?: string;           // canonical board pubkey for external RSVP
  rsvpStatus?: CalendarRsvpStatus; // local RSVP state (external)
  rsvpCreatedAt?: number;         // created_at for local RSVP (external)
  rsvpFb?: CalendarRsvpFb;         // free/busy for local RSVP (external)
};

export type DateCalendarEvent = CalendarEventBase & {
  kind: "date";
  startDate: string;              // YYYY-MM-DD
  endDate?: string;               // inclusive YYYY-MM-DD (UI-facing)
};

export type TimeCalendarEvent = CalendarEventBase & {
  kind: "time";
  startISO: string;               // ISO timestamp (UTC)
  endISO?: string;                // ISO timestamp (UTC)
  startTzid?: string;             // IANA TZID tag
  endTzid?: string;
};

export type CalendarEvent = DateCalendarEvent | TimeCalendarEvent;
export type ExternalCalendarEvent = CalendarEvent & {
  external: true;
  boardPubkey: string;
};

export function isExternalCalendarEvent(event: CalendarEvent): event is ExternalCalendarEvent {
  return event.external === true;
}

// ---- Edit state ----

export type EditItemType = "task" | "event";

export type EditingState =
  | { type: "task"; originalType: EditItemType; originalId: string; task: Task }
  | { type: "event"; originalType: EditItemType; originalId: string; event: CalendarEvent };

// ---- Board sort / grouping ----

export type BoardSortMode = "manual" | "due" | "priority" | "created" | "alpha";
export type BoardSortDirection = "asc" | "desc";
export type UpcomingBoardGrouping = "mixed" | "grouped";

// ---- Publish / complete function types ----

export type PublishTaskFn = (
  task: Task,
  boardOverride?: Board,
  options?: { skipBoardMetadata?: boolean }
) => Promise<void>;

export type PublishCalendarEventFn = (
  event: CalendarEvent,
  boardOverride?: Board,
  options?: { skipBoardMetadata?: boolean }
) => Promise<void>;

export type ScriptureMemoryUpdate = {
  entryId: string;
  completedAt: string;
  stageBefore?: number;
  nextScheduled?: { entryId: string; scheduledAtISO: string };
};

export type CompleteTaskResult = {
  scriptureMemory?: ScriptureMemoryUpdate;
} | null;

export type CompleteTaskFn = (
  id: string,
  options?: { skipScriptureMemoryUpdate?: boolean; inboxAction?: "accept" | "dismiss" | "decline" | "maybe" }
) => CompleteTaskResult;

// ---- Board types ----

export type ListColumn = { id: string; name: string };

export type CompoundIndexGroup = {
  key: string;
  boardId: string;
  boardName: string;
  columns: { id: string; name: string }[];
};

export type BoardBase = {
  id: string;
  name: string;
  // Optional Nostr sharing metadata
  nostr?: { boardId: string; relays: string[] };
  archived?: boolean;
  hidden?: boolean;
  clearCompletedDisabled?: boolean;
};

export type CompoundChildId = string;

export type Board =
  | (BoardBase & { kind: "week" }) // fixed Sun–Sat
  | (BoardBase & { kind: "lists"; columns: ListColumn[]; indexCardEnabled?: boolean }) // multiple customizable columns
  | (BoardBase & {
      kind: "compound";
      children: CompoundChildId[];
      indexCardEnabled?: boolean;
      hideChildBoardNames?: boolean;
    })
  | (BoardBase & { kind: "bible" });

export type ListLikeBoard = Extract<Board, { kind: "lists" | "compound" }>;

export function isListLikeBoard(board: Board | null | undefined): board is ListLikeBoard {
  return !!board && (board.kind === "lists" || board.kind === "compound");
}
