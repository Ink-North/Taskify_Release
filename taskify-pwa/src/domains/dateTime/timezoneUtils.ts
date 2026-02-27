import { getTimeZoneOffset, formatOffsetLabel, normalizeTimeZone } from "./dateUtils";

// ---- TimeZone option type ----

export type TimeZoneOption = {
  id: string;
  label: string;
  city: string;
  region: string;
  shortNames: string[];
  longNames: string[];
  offsetMinutes: number;
  offsetLabel: string;
  search: string;
};

// ---- Fallback timezone list ----

export const FALLBACK_TIME_ZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "America/Anchorage",
  "Pacific/Honolulu",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Moscow",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Bangkok",
  "Asia/Singapore",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Australia/Sydney",
];

let cachedTimeZoneOptions: TimeZoneOption[] | null = null;
let cachedTimeZoneOptionMap: Map<string, TimeZoneOption> | null = null;

// ---- Timezone helpers ----

export function getSupportedTimeZones(): string[] {
  try {
    const supported = typeof (Intl as any).supportedValuesOf === "function"
      ? (Intl as any).supportedValuesOf("timeZone")
      : null;
    if (Array.isArray(supported) && supported.length > 0) {
      return supported.includes("UTC") ? supported : ["UTC", ...supported];
    }
  } catch {}
  return FALLBACK_TIME_ZONES;
}

export function extractTimeZoneName(timeZone: string, date: Date, style: "short" | "long"): string {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: style });
    const part = formatter.formatToParts(date).find((entry) => entry.type === "timeZoneName");
    return part?.value?.trim() || "";
  } catch {
    return "";
  }
}

export function getTimeZoneLabelParts(timeZone: string): { label: string; city: string; region: string } {
  const parts = timeZone.split("/");
  const rawCity = parts[parts.length - 1] || timeZone;
  const city = rawCity.replace(/_/g, " ");
  const region = parts.slice(0, -1).join("/").replace(/_/g, " ");
  return { label: city || timeZone, city, region };
}

export function buildTimeZoneOption(timeZone: string, referenceDates: Date[]): TimeZoneOption | null {
  const normalized = normalizeTimeZone(timeZone) ?? (timeZone === "UTC" ? "UTC" : null);
  if (!normalized) return null;
  const { label, city, region } = getTimeZoneLabelParts(normalized);
  const shortNames = new Set<string>();
  const longNames = new Set<string>();
  referenceDates.forEach((date) => {
    const shortName = extractTimeZoneName(normalized, date, "short");
    const longName = extractTimeZoneName(normalized, date, "long");
    if (shortName) shortNames.add(shortName);
    if (longName) longNames.add(longName);
  });
  const offsetMinutes = Math.round(getTimeZoneOffset(new Date(), normalized) / 60000);
  const offsetLabel = formatOffsetLabel(offsetMinutes);
  const offsetAlias = offsetLabel.replace("UTC", "GMT");
  const search = [
    normalized,
    label,
    city,
    region,
    ...shortNames,
    ...longNames,
    offsetLabel,
    offsetAlias,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return {
    id: normalized,
    label,
    city,
    region,
    shortNames: Array.from(shortNames),
    longNames: Array.from(longNames),
    offsetMinutes,
    offsetLabel,
    search,
  };
}

export function getTimeZoneOptions(): { options: TimeZoneOption[]; map: Map<string, TimeZoneOption> } {
  if (cachedTimeZoneOptions && cachedTimeZoneOptionMap) {
    return { options: cachedTimeZoneOptions, map: cachedTimeZoneOptionMap };
  }
  const now = new Date();
  const year = now.getUTCFullYear();
  const referenceDates = [
    now,
    new Date(Date.UTC(year, 0, 1, 12, 0, 0)),
    new Date(Date.UTC(year, 6, 1, 12, 0, 0)),
  ];
  const options: TimeZoneOption[] = [];
  const map = new Map<string, TimeZoneOption>();
  const seen = new Set<string>();
  for (const zone of getSupportedTimeZones()) {
    if (!zone || seen.has(zone)) continue;
    seen.add(zone);
    const option = buildTimeZoneOption(zone, referenceDates);
    if (!option) continue;
    options.push(option);
    map.set(option.id, option);
  }
  options.sort((a, b) => {
    if (a.offsetMinutes !== b.offsetMinutes) return a.offsetMinutes - b.offsetMinutes;
    return a.label.localeCompare(b.label);
  });
  cachedTimeZoneOptions = options;
  cachedTimeZoneOptionMap = map;
  return { options, map };
}

export function formatTimeZoneDisplay(timeZone: string, optionMap: Map<string, TimeZoneOption>): string {
  const option = optionMap.get(timeZone);
  if (!option) return timeZone;
  const short = option.shortNames.find((name) => !!name) || "";
  if (short && short !== option.label) return `${option.label} (${short})`;
  return option.label;
}

export function scoreTimeZoneOption(option: TimeZoneOption, query: string): number {
  const normalized = query.toLowerCase();
  const isAbbrev = /^[a-z]{2,6}$/.test(normalized);
  const id = option.id.toLowerCase();
  const label = option.label.toLowerCase();
  const city = option.city.toLowerCase();
  const region = option.region.toLowerCase();
  const shortNames = option.shortNames.map((name) => name.toLowerCase());
  const longNames = option.longNames.map((name) => name.toLowerCase());

  if (
    id === normalized ||
    label === normalized ||
    city === normalized ||
    region === normalized ||
    shortNames.includes(normalized) ||
    longNames.includes(normalized)
  ) {
    return 0;
  }

  if (isAbbrev && shortNames.some((name) => name.startsWith(normalized))) return 1;

  if (
    id.startsWith(normalized) ||
    label.startsWith(normalized) ||
    city.startsWith(normalized) ||
    region.startsWith(normalized) ||
    shortNames.some((name) => name.startsWith(normalized)) ||
    longNames.some((name) => name.startsWith(normalized))
  ) {
    return 2;
  }

  return 3;
}
