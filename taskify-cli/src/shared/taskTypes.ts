// CLI-adapted version of taskTypes.ts (browser imports removed)

// ---- Stubs for types not needed in CLI ----
export type TaskDocument = unknown;
export type CalendarRsvpFb = string;
export type CalendarRsvpStatus = string;
export type SharedContactPayload = unknown;
export type SharedTaskPayload = unknown;

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
  createdBy?: string;
  lastEditedBy?: string;
  createdAt?: number;
  updatedAt?: string;
  title: string;
  priority?: TaskPriority;
  note?: string;
  images?: string[];
  documents?: TaskDocument[];
  dueISO: string;
  dueDateEnabled?: boolean;
  completed?: boolean;
  completedAt?: string;
  completedBy?: string;
  recurrence?: Recurrence;
  column?: "day";
  columnId?: string;
  hiddenUntilISO?: string;
  order?: number;
  streak?: number;
  longestStreak?: number;
  seriesId?: string;
  subtasks?: Subtask[];
  assignees?: TaskAssignee[];
  bounty?: {
    id: string;
    token: string;
    amount?: number;
    mint?: string;
    lock?: "p2pk" | "htlc" | "none" | "unknown";
    owner?: string;
    sender?: string;
    receiver?: string;
    state: "locked" | "unlocked" | "revoked" | "claimed";
    updatedAt: string;
    enc?:
      | { alg: "aes-gcm-256"; iv: string; ct: string }
      | { alg: "nip04"; data: string }
      | null;
  };
  dueTimeEnabled?: boolean;
  dueTimeZone?: string;
  reminders?: ReminderPreset[];
  reminderTime?: string;
  scriptureMemoryId?: string;
  scriptureMemoryStage?: number;
  scriptureMemoryPrevReviewISO?: string | null;
  scriptureMemoryScheduledAt?: string;
  bountyLists?: string[];
  bountyDeletedAt?: string;
  inboxItem?: InboxItem;
};

// ---- Calendar event types ----

export type CalendarEventParticipant = {
  pubkey: string;
  relay?: string;
  role?: string;
};

export type CalendarEventBase = {
  id: string;
  boardId: string;
  createdBy?: string;
  lastEditedBy?: string;
  columnId?: string;
  order?: number;
  title: string;
  summary?: string;
  description?: string;
  documents?: TaskDocument[];
  image?: string;
  locations?: string[];
  geohash?: string;
  participants?: CalendarEventParticipant[];
  hashtags?: string[];
  references?: string[];
  reminders?: ReminderPreset[];
  reminderTime?: string;
  hiddenUntilISO?: string;
  recurrence?: Recurrence;
  seriesId?: string;
  readOnly?: boolean;
  external?: boolean;
  originBoardId?: string;
  eventKey?: string;
  inviteTokens?: Record<string, string>;
  canonicalAddress?: string;
  viewAddress?: string;
  inviteToken?: string;
  inviteRelays?: string[];
  boardPubkey?: string;
  rsvpStatus?: CalendarRsvpStatus;
  rsvpCreatedAt?: number;
  rsvpFb?: CalendarRsvpFb;
};

export type DateCalendarEvent = CalendarEventBase & {
  kind: "date";
  startDate: string;
  endDate?: string;
};

export type TimeCalendarEvent = CalendarEventBase & {
  kind: "time";
  startISO: string;
  endISO?: string;
  startTzid?: string;
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
  nostr?: { boardId: string; relays: string[] };
  archived?: boolean;
  hidden?: boolean;
  clearCompletedDisabled?: boolean;
};

export type CompoundChildId = string;

export type Board =
  | (BoardBase & { kind: "week" })
  | (BoardBase & { kind: "lists"; columns: ListColumn[]; indexCardEnabled?: boolean })
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
