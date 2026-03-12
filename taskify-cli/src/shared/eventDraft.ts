type CalendarEvent =
  | {
      id: string;
      boardId: string;
      title: string;
      kind: "date";
      startDate: string;
      endDate?: string;
    }
  | {
      id: string;
      boardId: string;
      title: string;
      kind: "time";
      startISO: string;
      endISO?: string;
      startTzid?: string;
      endTzid?: string;
    };

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function normalizeTimeZone(tz?: string): string | undefined {
  if (!tz) return undefined;
  const trimmed = tz.trim();
  if (!trimmed) return undefined;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: trimmed });
    return trimmed;
  } catch {
    return undefined;
  }
}

function isoFromDateTime(dateKey: string, time = "00:00", _tz?: string): string {
  return new Date(`${dateKey}T${time}:00Z`).toISOString();
}

type BuildCalendarEventDraftInput = {
  boardId: string;
  title: string;
  date: string;
  endDate?: string;
  time?: string;
  endTime?: string;
  timeZone?: string;
};

export function buildCalendarEventDraft(input: BuildCalendarEventDraftInput): CalendarEvent {
  const boardId = input.boardId.trim();
  const title = input.title.trim();
  const date = input.date.trim();
  const endDate = input.endDate?.trim();
  const time = input.time?.trim();
  const endTime = input.endTime?.trim();
  const tz = normalizeTimeZone(input.timeZone) ?? undefined;

  if (!boardId) throw new Error("boardId is required");
  if (!title) throw new Error("title is required");
  if (!ISO_DATE_RE.test(date)) throw new Error("date must be YYYY-MM-DD");
  if (endDate && !ISO_DATE_RE.test(endDate)) throw new Error("endDate must be YYYY-MM-DD");
  if (time && !HHMM_RE.test(time)) throw new Error("time must be HH:mm");
  if (endTime && !HHMM_RE.test(endTime)) throw new Error("endTime must be HH:mm");

  if ((time || endTime) && endDate) {
    throw new Error("Cannot combine endDate with timed event. Use endTime for timed ranges.");
  }

  const id = crypto.randomUUID();

  if (time || endTime) {
    const start = isoFromDateTime(date, time || "00:00", tz);
    const end = endTime ? isoFromDateTime(date, endTime, tz) : undefined;
    return {
      id,
      boardId,
      title,
      kind: "time",
      startISO: start,
      ...(end ? { endISO: end } : {}),
      ...(tz ? { startTzid: tz, endTzid: tz } : {}),
    };
  }

  return {
    id,
    boardId,
    title,
    kind: "date",
    startDate: date,
    ...(endDate && endDate >= date ? { endDate } : {}),
  };
}
