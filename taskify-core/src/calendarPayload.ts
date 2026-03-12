export type CalendarNormalizedPayload = {
  kind?: "date" | "time";
  title?: string;
  summary?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  startISO?: string;
  endISO?: string;
  startTzid?: string;
  endTzid?: string;
  locations?: string[];
  hashtags?: string[];
  references?: string[];
  deleted?: boolean;
};

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
  return out.length ? out : undefined;
}

export function normalizeCalendarEventPayload(raw: unknown): CalendarNormalizedPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const deleted = (raw as any).deleted === true;
  const kindRaw = (raw as any).kind;
  const kind = kindRaw === "date" || kindRaw === "time" ? kindRaw : undefined;
  const title = normalizeString((raw as any).title);

  if (!deleted && !title) return null;

  const payload: CalendarNormalizedPayload = {
    ...(deleted ? { deleted: true } : {}),
    ...(kind ? { kind } : {}),
    ...(title ? { title } : {}),
  };

  const summary = normalizeString((raw as any).summary);
  if (summary) payload.summary = summary;
  const description = normalizeString((raw as any).description);
  if (description) payload.description = description;

  const startDate = normalizeString((raw as any).startDate);
  if (startDate) payload.startDate = startDate;
  const endDate = normalizeString((raw as any).endDate);
  if (endDate) payload.endDate = endDate;
  const startISO = normalizeString((raw as any).startISO);
  if (startISO) payload.startISO = startISO;
  const endISO = normalizeString((raw as any).endISO);
  if (endISO) payload.endISO = endISO;
  const startTzid = normalizeString((raw as any).startTzid);
  if (startTzid) payload.startTzid = startTzid;
  const endTzid = normalizeString((raw as any).endTzid);
  if (endTzid) payload.endTzid = endTzid;

  const locations = normalizeStringArray((raw as any).locations);
  if (locations) payload.locations = locations;
  const hashtags = normalizeStringArray((raw as any).hashtags);
  if (hashtags) payload.hashtags = hashtags;
  const references = normalizeStringArray((raw as any).references);
  if (references) payload.references = references;

  if (!deleted) {
    if (payload.kind === "date" && !payload.startDate) return null;
    if (payload.kind === "time" && !payload.startISO) return null;
  }

  return payload;
}
