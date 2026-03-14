import type { BoardEntry } from "../config.js";

const WEEK_DAY_MAP: Record<string, number> = {
  mon: 0,
  monday: 0,
  tue: 1,
  tues: 1,
  tuesday: 1,
  wed: 2,
  wednesday: 2,
  thu: 3,
  thur: 3,
  thurs: 3,
  thursday: 3,
  fri: 4,
  friday: 4,
  sat: 5,
  saturday: 5,
  sun: 6,
  sunday: 6,
};

export type ColumnResolution =
  | { ok: true; column: { id: string; name: string }; via: "id" | "name" | "week-day" }
  | { ok: false; reason: "no-columns" | "not-found" | "ambiguous"; available: { id: string; name: string }[]; matches?: { id: string; name: string }[] };

function resolveWeekDayToISO(dayKey: string): string {
  const offset = WEEK_DAY_MAP[dayKey];
  const today = new Date();
  const jsDay = today.getDay();
  const mondayShift = jsDay === 0 ? -6 : 1 - jsDay;
  const monday = new Date(today);
  monday.setDate(today.getDate() + mondayShift);
  monday.setHours(0, 0, 0, 0);
  const target = new Date(monday);
  target.setDate(monday.getDate() + offset);
  const y = target.getFullYear();
  const m = String(target.getMonth() + 1).padStart(2, "0");
  const d = String(target.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function resolveBoardColumn(entry: BoardEntry, columnArg: string): ColumnResolution {
  const dayKey = columnArg.toLowerCase();
  if (dayKey in WEEK_DAY_MAP && entry.kind === "week") {
    return {
      ok: true,
      via: "week-day",
      column: { id: resolveWeekDayToISO(dayKey), name: columnArg },
    };
  }

  const available = [...(entry.columns ?? [])];
  if (available.length === 0) return { ok: false, reason: "no-columns", available };

  const byId = available.find((c) => c.id === columnArg);
  if (byId) return { ok: true, via: "id", column: byId };

  const exact = available.filter((c) => c.name === columnArg);
  if (exact.length === 1) return { ok: true, via: "name", column: exact[0] };
  if (exact.length > 1) return { ok: false, reason: "ambiguous", available, matches: exact };

  const lower = columnArg.toLowerCase();
  const byName = available.filter((c) => c.name.toLowerCase() === lower);
  if (byName.length === 1) return { ok: true, via: "name", column: byName[0] };
  if (byName.length > 1) return { ok: false, reason: "ambiguous", available, matches: byName };

  return { ok: false, reason: "not-found", available };
}

export function formatAvailableColumns(columns: { id: string; name: string }[]): string {
  if (columns.length === 0) return "(none)";
  return columns.map((col) => `- ${col.name} (${col.id})`).join("\n");
}
