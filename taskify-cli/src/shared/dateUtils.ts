// Minimal date utilities for taskify-cli (no browser dependencies)

export function startOfDay(d: Date): Date {
  const result = new Date(d);
  result.setHours(0, 0, 0, 0);
  return result;
}

export function isoDatePart(iso: string, tz?: string | null): string {
  if (!iso) return "";
  try {
    if (tz) {
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(date);
      const year = parts.find((p) => p.type === "year")?.value ?? "";
      const month = parts.find((p) => p.type === "month")?.value ?? "";
      const day = parts.find((p) => p.type === "day")?.value ?? "";
      return `${year}-${month}-${day}`;
    }
  } catch {
    // fall through
  }
  return iso.slice(0, 10);
}

export function isoTimePart(iso: string, tz?: string | null): string {
  if (!iso) return "";
  try {
    if (tz) {
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) return "";
      const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: tz,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).formatToParts(date);
      const hour = parts.find((p) => p.type === "hour")?.value ?? "";
      const minute = parts.find((p) => p.type === "minute")?.value ?? "";
      return `${hour}:${minute}`;
    }
  } catch {
    // fall through
  }
  // UTC fallback
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const h = String(d.getUTCHours()).padStart(2, "0");
  const m = String(d.getUTCMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

export function isoTimePartUtc(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const h = String(d.getUTCHours()).padStart(2, "0");
  const m = String(d.getUTCMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

export function parseDateKey(key: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

export function formatDateKeyFromParts(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function isoFromDateTime(dateKey: string, time?: string, tz?: string): string {
  if (!time) {
    return new Date(`${dateKey}T00:00:00Z`).toISOString();
  }
  if (tz) {
    try {
      // Build a date string and convert from the given timezone
      const localStr = `${dateKey}T${time}:00`;
      const date = new Date(
        new Intl.DateTimeFormat("en-CA", {
          timeZone: tz,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        }).format(new Date(localStr))
      );
      if (!Number.isNaN(date.getTime())) return date.toISOString();
    } catch {
      // fall through
    }
  }
  return new Date(`${dateKey}T${time}:00Z`).toISOString();
}

export function normalizeTimeZone(tz?: string | null): string | null {
  if (!tz || typeof tz !== "string") return null;
  const trimmed = tz.trim();
  if (!trimmed) return null;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: trimmed });
    return trimmed;
  } catch {
    return null;
  }
}
