import type React from "react";
import type { TaskDocument } from "../../lib/documents";

export type UploadingDocumentRow = {
  id: string;
  name: string;
  kind: string;
  progress: number;
  phase: "uploading" | "processing";
};

export function createUploadingDocumentRow(doc: TaskDocument, fallbackName: string): UploadingDocumentRow {
  return {
    id: `${doc.id}-uploading`,
    name: doc.name || fallbackName || "attachment",
    kind: doc.kind.toUpperCase(),
    progress: 0,
    phase: "uploading",
  };
}

export function updateUploadingDocumentRowProgress(rows: UploadingDocumentRow[], id: string, progress: number): UploadingDocumentRow[] {
  const clamped = Math.max(0, Math.min(progress, 1));
  return rows.map((row) => (row.id === id ? { ...row, progress: clamped } : row));
}

export function removeUploadingDocumentRow(rows: UploadingDocumentRow[], id: string): UploadingDocumentRow[] {
  return rows.filter((row) => row.id !== id);
}

export function startUploadingDotsTimer(
  rowCount: number,
  setUploadingDotPhase: React.Dispatch<React.SetStateAction<number>>,
): (() => void) | undefined {
  if (!rowCount) {
    setUploadingDotPhase(0);
    return undefined;
  }
  const interval = window.setInterval(() => {
    setUploadingDotPhase((prev) => (prev + 1) % 4);
  }, 420);
  return () => window.clearInterval(interval);
}


export function setUploadingDocumentRowPhase(rows: UploadingDocumentRow[], id: string, phase: "uploading" | "processing"): UploadingDocumentRow[] {
  return rows.map((row) => (row.id === id ? { ...row, phase, progress: phase === "processing" ? Math.max(row.progress, 1) : row.progress } : row));
}
