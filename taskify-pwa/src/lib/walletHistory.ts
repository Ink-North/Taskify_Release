export const MARK_HISTORY_ENTRIES_OLDER_SPENT_EVENT = "taskify:mark-history-entries-old-spent";

export interface MarkHistoryEntriesOldSpentEventDetail {
  cutoffMs: number;
}

export type HistoryEntryRaw = {
  summary?: string;
  tokenState?: {
    proofs?: Array<Record<string, unknown> | null>;
    lastState?: string;
    lastSummary?: string;
    lastCheckedAt?: number;
    notifiedSpent?: boolean;
    suppressChecks?: boolean;
    lastError?: string;
    lastErrorAt?: number;
    errorCount?: number;
    [key: string]: unknown;
  } | null;
  createdAt?: number;
  [key: string]: unknown;
};

export function markHistoryEntrySpentRaw(entry: HistoryEntryRaw, timestamp: number): HistoryEntryRaw | null {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const tokenState = entry.tokenState;
  if (!tokenState || !Array.isArray(tokenState.proofs) || tokenState.proofs.length === 0) {
    return null;
  }
  const updatedProofs = tokenState.proofs.map((proof) => {
    if (!proof || typeof proof !== "object") {
      return proof;
    }
    return { ...proof, lastState: "SPENT" };
  });
  const nextTokenState = {
    ...tokenState,
    proofs: updatedProofs,
    lastState: "SPENT",
    lastSummary: tokenState.lastSummary || "SPENT",
    lastCheckedAt: timestamp,
    notifiedSpent: true,
    suppressChecks: true,
  };
  delete (nextTokenState as Record<string, unknown>).lastError;
  delete (nextTokenState as Record<string, unknown>).lastErrorAt;
  delete (nextTokenState as Record<string, unknown>).errorCount;
  const summary = typeof entry.summary === "string" ? entry.summary : "History entry";
  const nextSummary = summary.includes("(spent)") ? summary : `${summary} (spent)`;
  return {
    ...entry,
    summary: nextSummary,
    tokenState: nextTokenState,
  };
}
