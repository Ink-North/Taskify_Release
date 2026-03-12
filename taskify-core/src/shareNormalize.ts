import { parseCalendarAddress } from "./calendarProtocol.js";
import { parseShareEnvelope } from "./shareContracts.js";

const BOARD_ID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type BoardSharePayload = {
  boardId: string;
  boardName?: string;
  relaysCsv?: string;
};

export function normalizeCalendarAddress(value: unknown, allowedKinds: number[]): string | null {
  if (typeof value !== "string") return null;
  const parsed = parseCalendarAddress(value);
  if (!parsed) return null;
  if (!allowedKinds.includes(parsed.kind)) return null;
  return `${parsed.kind}:${parsed.pubkey}:${parsed.d}`;
}

export function parseBoardSharePayload(raw: string): BoardSharePayload | null {
  const trimmed = (raw || "").trim();
  if (!trimmed) return null;
  const envelope = parseShareEnvelope(trimmed);
  if (envelope?.item?.type === "board") {
    const relaysCsv = envelope.item.relays?.length ? envelope.item.relays.join(",") : undefined;
    return {
      boardId: envelope.item.boardId,
      boardName: envelope.item.boardName || undefined,
      relaysCsv,
    };
  }
  if (!BOARD_ID_REGEX.test(trimmed)) return null;
  return { boardId: trimmed };
}
