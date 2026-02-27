import React, { useMemo } from "react";
import type { Task } from "../../domains/tasks/taskTypes";
import { TASK_PRIORITY_MARKS } from "../../domains/tasks/taskTypes";
import { normalizeTaskPriority } from "../../domains/tasks/taskUtils";
import { useUrlPreview, extractFirstUrl, isUrlLike } from "../../lib/urlPreview";
import type { UrlPreviewData } from "../../lib/urlPreview";

export function autolink(text: string) {
  const parts = text.split(/(https?:\/\/[^\s)]+)/gi);
  return (
    <>
      {parts.map((p, i) =>
        /^https?:\/\//i.test(p) ? (
          <a key={i} href={p} target="_blank" rel="noopener noreferrer" className="link-accent break-words">
            {p}
          </a>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </>
  );
}

const URL_IN_TEXT_GLOBAL = /https?:\/\/[^\s)]+/gi;

export function stripUrlsFromText(text: string | undefined): string {
  if (!text) return "";
  return text.replace(URL_IN_TEXT_GLOBAL, "").trim();
}

export function fallbackTitleFromUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.replace(/^www\./i, "");
    const segments = parsed.pathname.split("/").filter(Boolean).slice(0, 2);
    const pathPart = segments.length ? ` / ${segments.join(" / ")}` : "";
    return (host || parsed.hostname || rawUrl) + pathPart;
  } catch {
    return rawUrl;
  }
}

function taskPriorityMarks(priority: ReturnType<typeof normalizeTaskPriority>): string {
  return priority ? TASK_PRIORITY_MARKS[priority] : "";
}

export function useTaskPreview(task: Task): UrlPreviewData | null {
  const previewSource = useMemo(() => `${task.title} ${task.note || ""}`, [task.title, task.note]);
  return useUrlPreview(previewSource);
}

export function TaskTitle({ task }: { task: Task }) {
  const derivedPreview = useTaskPreview(task);
  const isTitleUrl = isUrlLike(task.title);
  const urlFromTitle = isTitleUrl ? task.title.trim() : null;
  const urlFromNote = extractFirstUrl(task.note || "");
  const canonicalUrl = derivedPreview?.finalUrl || derivedPreview?.url || urlFromTitle || urlFromNote;
  const priority = normalizeTaskPriority(task.priority);
  const priorityLabel = taskPriorityMarks(priority);
  const priorityNode = priorityLabel ? (
    <span className="ml-1 text-rose-500 font-semibold">{priorityLabel}</span>
  ) : null;

  let titleNode: React.ReactNode = task.title;
  if (isTitleUrl) {
    const titleTarget = urlFromTitle || canonicalUrl || task.title.trim();
    const displayTitle = derivedPreview?.title || derivedPreview?.displayUrl || fallbackTitleFromUrl(titleTarget);
    if (canonicalUrl) {
      titleNode = <span className="link-accent">{displayTitle}</span>;
    } else {
      titleNode = displayTitle;
    }
  } else if (canonicalUrl) {
    titleNode = <span className="link-accent">{task.title}</span>;
  }

  return (
    <>
      {titleNode}
      {priorityNode}
    </>
  );
}
