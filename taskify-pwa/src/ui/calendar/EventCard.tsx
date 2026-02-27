import React, { useMemo, useCallback } from "react";
import type { CalendarEvent } from "../../domains/tasks/taskTypes";
import { normalizeTimeZone } from "../../domains/dateTime/dateUtils";
import { isoDatePart } from "../../domains/dateTime/dateUtils";
import { toNpub } from "../../lib/nostr";
import { isUrlLike, extractFirstUrl } from "../../lib/urlPreview";
import { stripUrlsFromText } from "../task/TaskTitle";
import { EventTitle, EventMedia } from "../task/TaskMedia";
import type { TaskDocument } from "../../lib/documents";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function getDraggedEventId(dataTransfer: DataTransfer | null | undefined) {
  if (!dataTransfer) return null;
  const id = dataTransfer.getData("text/event-id");
  return id || null;
}

function formatTimeLabel(iso: string, timeZone?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const safeZone = normalizeTimeZone(timeZone);
  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    ...(safeZone ? { timeZone: safeZone } : {}),
  });
}

export function EventCard({
  event,
  onEdit,
  showDate,
  meta,
  trailing,
  onOpenDocument,
  onDragStart,
  onDragEnd,
}: {
  event: CalendarEvent;
  onEdit?: () => void;
  showDate?: boolean;
  meta?: React.ReactNode;
  trailing?: React.ReactNode;
  onOpenDocument?: (event: CalendarEvent, doc: TaskDocument) => void;
  onDragStart?: (id: string) => void;
  onDragEnd?: () => void;
}) {
  const iconSizeStyle = useMemo(() => ({ "--icon-size": "1.85rem" } as React.CSSProperties), []);
  const creatorNpub = useMemo(() => toNpub(event.createdBy || event.boardPubkey || ""), [event.createdBy, event.boardPubkey]);
  const lastEditorNpub = useMemo(
    () => toNpub(event.lastEditedBy || event.createdBy || event.boardPubkey || ""),
    [event.lastEditedBy, event.createdBy, event.boardPubkey],
  );
  const dateKey = useMemo(() => {
    if (event.kind === "date") return ISO_DATE_PATTERN.test(event.startDate) ? event.startDate : isoDatePart(new Date().toISOString());
    return isoDatePart(event.startISO, event.startTzid);
  }, [event]);
  const timeLabel = useMemo(() => {
    if (event.kind === "date") {
      const startKey = ISO_DATE_PATTERN.test(event.startDate) ? event.startDate : dateKey;
      const endKey = event.endDate && ISO_DATE_PATTERN.test(event.endDate) && event.endDate >= startKey ? event.endDate : "";
      const formatShort = (key: string) => {
        const parsed = new Date(`${key}T00:00:00`);
        if (Number.isNaN(parsed.getTime())) return key;
        return parsed.toLocaleDateString([], { month: "short", day: "numeric" });
      };
      if (!showDate) return "All-day";
      if (endKey && endKey !== startKey) {
        return `All-day • ${formatShort(startKey)} – ${formatShort(endKey)}`;
      }
      return `All-day • ${formatShort(startKey)}`;
    }

    const start = formatTimeLabel(event.startISO, event.startTzid);
    const end = event.endISO ? formatTimeLabel(event.endISO, event.endTzid || event.startTzid) : "";
    const core = end ? `${start} – ${end}` : start;
    if (!showDate) return core;
    const parsed = new Date(`${dateKey}T00:00:00`);
    const dateLabel = Number.isNaN(parsed.getTime())
      ? dateKey
      : parsed.toLocaleDateString([], { month: "short", day: "numeric" });
    return `${core} • ${dateLabel}`;
  }, [dateKey, event, showDate]);
  const locationLabel = useMemo(() => {
    const loc = event.locations?.find((value) => typeof value === "string" && value.trim())?.trim() ?? "";
    return loc || "";
  }, [event.locations]);
  const metaNode = meta ?? (locationLabel ? locationLabel : null);
  const hasUrl = useMemo(
    () => isUrlLike(event.title) || Boolean(extractFirstUrl(`${event.description || ""} ${(event.references || []).join(" ")}`)),
    [event.description, event.references, event.title],
  );
  const hasDetail =
    !!stripUrlsFromText(event.description) ||
    (event.documents && event.documents.length > 0) ||
    hasUrl;
  const isInteractive = typeof onEdit === "function";
  const isDraggable = typeof onDragStart === "function";

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!onEdit) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onEdit();
      }
    },
    [onEdit],
  );
  const handleDragStart = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (!onDragStart) return;
      e.dataTransfer.setData("text/event-id", event.id);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setDragImage(e.currentTarget, 0, 0);
      onDragStart(event.id);
    },
    [event.id, onDragStart],
  );
  const handleDragEnd = useCallback(() => {
    onDragEnd?.();
  }, [onDragEnd]);

  return (
    <div
      className="task-card group relative select-none"
      data-form={hasDetail ? "stacked" : "pill"}
      data-event-id={event.id}
      data-agent-entity="event"
      data-agent-creator-npub={creatorNpub || undefined}
      data-agent-last-editor-npub={lastEditorNpub || undefined}
      style={{ touchAction: "auto" }}
      draggable={isDraggable}
      onDragStart={isDraggable ? handleDragStart : undefined}
      onDragEnd={isDraggable ? handleDragEnd : undefined}
    >
      <div className="flex items-start gap-3">
        <div className="icon-button flex-shrink-0" style={iconSizeStyle} aria-hidden="true">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            className="pointer-events-none h-[18px] w-[18px]"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        </div>
        <div
          className={`flex-1 min-w-0 space-y-1 ${isInteractive ? "cursor-pointer" : ""}`}
          role={isInteractive ? "button" : undefined}
          tabIndex={isInteractive ? 0 : undefined}
          onClick={onEdit}
          onKeyDown={isInteractive ? handleKeyDown : undefined}
        >
          <div className="task-card__title">{event.title ? <EventTitle event={event} /> : "Untitled"}</div>
          <div className="text-xs text-secondary">{timeLabel}</div>
          {metaNode ? <div className="task-card__meta">{metaNode}</div> : null}
        </div>
        {trailing ? <div className="flex-shrink-0 pt-0.5">{trailing}</div> : null}
      </div>
      <EventMedia event={event} onOpenDocument={onOpenDocument} />
    </div>
  );
}
