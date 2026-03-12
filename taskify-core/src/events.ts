export type CalendarEvent =
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
const TIME_ZONE_VALIDATION_CACHE = new Map<string, string | null>();

function normalizeTimeZone(value?: string | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (TIME_ZONE_VALIDATION_CACHE.has(trimmed)) return TIME_ZONE_VALIDATION_CACHE.get(trimmed) ?? null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: trimmed }).format(new Date());
    TIME_ZONE_VALIDATION_CACHE.set(trimmed, trimmed);
    return trimmed;
  } catch {
    TIME_ZONE_VALIDATION_CACHE.set(trimmed, null);
    return null;
  }
}

function parseDateKey(value: string): { year: number; month: number; day: number } | null {
  if (!ISO_DATE_RE.test(value)) return null;
  const [yearRaw, monthRaw, dayRaw] = value.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  return { year, month, day };
}

function parseTimeValue(value: string): { hour: number; minute: number } | null {
  if (typeof value !== "string" || !value.includes(":")) return null;
  const [hourRaw, minuteRaw] = value.split(":");
  const hour = Number.parseInt(hourRaw ?? "", 10);
  const minute = Number.parseInt(minuteRaw ?? "", 10);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return {
    hour: Math.min(23, Math.max(0, hour)),
    minute: Math.min(59, Math.max(0, minute)),
  };
}

function getTimeZoneOffset(date: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  const second = Number(parts.find((part) => part.type === "second")?.value);
  if ([year, month, day, hour, minute, second].some((value) => !Number.isFinite(value))) return 0;
  const asUTC = Date.UTC(year, month - 1, day, hour, minute, second);
  return asUTC - date.getTime();
}

function zonedTimeToUtc(dateStr: string, timeStr: string, timeZone: string): Date | null {
  const parsedDate = parseDateKey(dateStr);
  const parsedTime = parseTimeValue(timeStr);
  if (!parsedDate || !parsedTime) return null;
  const { year, month, day } = parsedDate;
  const { hour, minute } = parsedTime;
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const offset = getTimeZoneOffset(utcGuess, timeZone);
  let adjusted = new Date(utcGuess.getTime() - offset);
  const offsetCheck = getTimeZoneOffset(adjusted, timeZone);
  if (offsetCheck !== offset) {
    adjusted = new Date(utcGuess.getTime() - offsetCheck);
  }
  return adjusted;
}

function isoFromDateTime(dateStr: string, timeStr?: string, timeZone?: string): string {
  const safeZone = normalizeTimeZone(timeZone);
  if (dateStr) {
    if (safeZone && ISO_DATE_RE.test(dateStr)) {
      const timeValue = timeStr || "00:00";
      const zoned = zonedTimeToUtc(dateStr, timeValue, safeZone);
      if (zoned && !Number.isNaN(zoned.getTime())) return zoned.toISOString();
    }
    if (timeStr) {
      const withTime = new Date(`${dateStr}T${timeStr}`);
      if (!Number.isNaN(withTime.getTime())) return withTime.toISOString();
    }
    const midnight = new Date(`${dateStr}T00:00`);
    if (!Number.isNaN(midnight.getTime())) return midnight.toISOString();
  }
  const parsed = new Date(dateStr);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  return new Date().toISOString();
}

export type BuildCalendarEventDraftInput = {
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
    const start = isoFromDateTime(date, time || "09:00", tz);
    const endCandidate = isoFromDateTime(date, endTime || "10:00", tz);
    const startMs = Date.parse(start);
    const endMs = Date.parse(endCandidate);
    const end = !Number.isNaN(startMs) && !Number.isNaN(endMs) && endMs > startMs ? endCandidate : undefined;
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
