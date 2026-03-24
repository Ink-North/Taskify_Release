import React, { useEffect, useRef, useState } from "react";
import { useVoiceSession, isSpeechRecognitionSupported } from "../nostr/useVoiceSession";
import type { FinalTask, TaskCandidate } from "../nostr/useVoiceSession";

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

export type VoiceDictationModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSave: (tasks: FinalTask[]) => void;
  workerBaseUrl: string;
  npub: string;
  defaultBoardId?: string;
  testingMode?: boolean;
};

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function MicButton({
  isListening,
  disabled,
  onStart,
  onStop,
}: {
  isListening: boolean;
  disabled: boolean;
  onStart: () => void;
  onStop: () => void;
}) {
  return (
    <button
      type="button"
      onClick={isListening ? onStop : onStart}
      disabled={disabled}
      aria-label={isListening ? "Stop recording" : "Start recording"}
      className={[
        "relative flex items-center justify-center w-14 h-14 rounded-full transition-all duration-200",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-violet-500",
        disabled
          ? "bg-gray-200 dark:bg-gray-700 text-gray-400 cursor-not-allowed"
          : isListening
            ? "bg-red-500 hover:bg-red-600 text-white shadow-lg"
            : "bg-violet-600 hover:bg-violet-700 text-white shadow-md",
      ].join(" ")}
    >
      {/* Pulse ring while listening */}
      {isListening && (
        <span className="absolute inset-0 rounded-full bg-red-400 animate-ping opacity-60" />
      )}
      <MicIcon className="relative w-6 h-6" />
    </button>
  );
}

function CandidateCard({
  candidate,
  onDismiss,
  onConfirm,
}: {
  candidate: TaskCandidate;
  onDismiss: (id: string) => void;
  onConfirm: (id: string) => void;
}) {
  const isConfirmed = candidate.status === "confirmed";
  const isDismissed = candidate.status === "dismissed";

  return (
    <li
      className={`task-card animate-slide-up space-y-1.5 ${isDismissed ? "opacity-45" : ""}`}
      data-form={candidate.subtasks?.length ? "stacked" : "pill"}
      data-state={isDismissed ? "completed" : undefined}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={() => (isDismissed ? onConfirm(candidate.id) : isConfirmed ? onDismiss(candidate.id) : onConfirm(candidate.id))}
          aria-label={isConfirmed ? "Deselect task" : "Select task"}
          className={`icon-button mt-0.5 ${isConfirmed ? "icon-button--accent" : ""}`}
          data-active={isConfirmed ? "true" : "false"}
        >
          {isConfirmed ? "✓" : "○"}
        </button>

        <div className="flex-1 min-w-0">
          <div className={`task-card__title ${isDismissed ? "task-card__title--done" : ""}`}>
            {candidate.title}
          </div>
          {candidate.dueText && !isDismissed && (
            <div className="task-card__meta mt-0.5">📅 {candidate.dueText}</div>
          )}
          {!!candidate.subtasks?.length && !isDismissed && (
            <ul className="mt-1 space-y-1 text-xs">
              {candidate.subtasks.map((s, i) => (
                <li key={`${candidate.id}-sub-${i}`} className="subtask-row">
                  <input type="checkbox" checked={false} readOnly className="subtask-row__checkbox" />
                  <span className="subtask-row__text">{s}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {!isDismissed && (
          <button
            type="button"
            onClick={() => onDismiss(candidate.id)}
            aria-label="Remove task"
            className="icon-button icon-button--danger"
          >
            ✕
          </button>
        )}
      </div>
    </li>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Icon helpers
// ─────────────────────────────────────────────────────────────────────────────

function MicIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="2" width="6" height="11" rx="3" />
      <path d="M19 10a7 7 0 01-14 0" />
      <line x1="12" y1="19" x2="12" y2="22" />
      <line x1="8" y1="22" x2="16" y2="22" />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main modal
// ─────────────────────────────────────────────────────────────────────────────

export function VoiceDictationModal({
  isOpen,
  onClose,
  onSave,
  workerBaseUrl,
  npub,
  defaultBoardId,
  testingMode = false,
}: VoiceDictationModalProps) {
  const supported = isSpeechRecognitionSupported();
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  const handleSave = async (tasks: FinalTask[]) => {
    onSave(tasks);
    onClose();
  };

  const [testingText, setTestingText] = useState("");

  const { session, startListening, stopListening, dismissCandidate, confirmCandidate, extractFromText, save, reset } =
    useVoiceSession({ workerBaseUrl, npub, defaultBoardId, onSave: handleSave });

  // Auto-scroll transcript area when text grows
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [session.transcript, session.interimTranscript]);

  // Stop listening when modal closes
  useEffect(() => {
    if (!isOpen) {
      stopListening();
    }
  }, [isOpen, stopListening]);

  // Reset state when modal opens fresh
  const prevOpen = useRef(false);
  useEffect(() => {
    if (isOpen && !prevOpen.current) {
      reset();
    }
    prevOpen.current = isOpen;
  }, [isOpen, reset]);

  if (!isOpen) return null;

  const confirmedCount = session.candidates.filter((c) => c.status === "confirmed").length;
  const visibleCandidates = session.candidates.filter((c) => c.status !== "dismissed");
  const hasDraftCandidates = session.candidates.some((c) => c.status === "draft");

  const saveLabel =
    confirmedCount === 0
      ? "Save Tasks"
      : confirmedCount === 1
        ? "Save 1 Task"
        : `Save ${confirmedCount} Tasks`;

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/45 backdrop-blur-md"
      onClick={(e) => {
        if (e.target === e.currentTarget && !session.isListening) onClose();
      }}
    >
      {/* Sheet */}
      <div className="relative w-full sm:max-w-md surface-panel glass-panel rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[90dvh] border border-white/20">

        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-4 pb-2 flex-shrink-0">
          <h2 className="text-base font-semibold text-primary flex items-center gap-2">
            🎙 Voice Add Tasks
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none">
              <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Not supported notice */}
        {!supported && (
          <div className="mx-4 mb-3 px-3 py-2.5 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 text-sm text-amber-700 dark:text-amber-400">
            Voice dictation is not supported in this browser. Try Chrome or Safari.
          </div>
        )}

        {/* Quota exhausted banner */}
        {session.quotaExhausted && (
          <div className="mx-4 mb-2 px-3 py-2 rounded-xl bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-700 text-sm text-orange-700 dark:text-orange-400">
            Daily voice limit reached. Showing extracted tasks below.
          </div>
        )}

        {/* Transcript area */}
        <div className="mx-4 mb-3 min-h-[60px] max-h-[100px] overflow-y-auto rounded-xl border border-white/20 bg-white/10 px-3 py-2.5 text-sm flex-shrink-0">
          {session.transcript || session.interimTranscript ? (
            <>
              <span className="text-gray-900 dark:text-gray-100">{session.transcript}</span>
              {session.transcript && session.interimTranscript && " "}
              {session.interimTranscript && (
                <span className="text-gray-400 dark:text-gray-500 italic">
                  {session.interimTranscript}
                </span>
              )}
            </>
          ) : (
            <span className="text-gray-400 dark:text-gray-500 italic">
              {session.isListening ? "Listening…" : "Tap the mic to start speaking"}
            </span>
          )}
          <div ref={transcriptEndRef} />
        </div>

        {/* Testing-only text input (bypass speech capture) */}
        {testingMode && (
          <div className="mx-4 mb-3 rounded-xl border border-dashed border-violet-300 dark:border-violet-700 bg-violet-50/50 dark:bg-violet-900/10 p-3">
            <div className="text-xs font-semibold text-violet-700 dark:text-violet-300 mb-2">Testing input</div>
            <textarea
              value={testingText}
              onChange={(e) => setTestingText(e.target.value)}
              placeholder="Paste dictated transcript here for testing..."
              className="w-full min-h-[84px] rounded-lg px-2.5 py-2 text-sm bg-white dark:bg-gray-800 border border-violet-200 dark:border-violet-700"
            />
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-50"
                disabled={!testingText.trim() || session.isProcessing}
                onClick={() => { void extractFromText(testingText); }}
              >
                Extract from text
              </button>
              <button
                type="button"
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300"
                onClick={() => setTestingText("")}
              >
                Clear
              </button>
            </div>
          </div>
        )}

        {/* Candidate cards */}
        {visibleCandidates.length > 0 && (
          <div className="mx-4 overflow-y-auto flex-1 pb-1">
            {/* "Select all" shortcut when any drafts exist */}
            {hasDraftCandidates && (
              <button
                type="button"
                onClick={() => {
                  session.candidates
                    .filter((c) => c.status === "draft")
                    .forEach((c) => confirmCandidate(c.id));
                }}
                className="text-xs text-secondary self-end hover:underline mb-1"
              >
                Select all
              </button>
            )}
            <ul className="space-y-1.5">
              {visibleCandidates.map((candidate) => (
                <CandidateCard
                  key={candidate.id}
                  candidate={candidate}
                  onDismiss={dismissCandidate}
                  onConfirm={confirmCandidate}
                />
              ))}
            </ul>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center gap-3 px-4 py-4 flex-shrink-0 border-t border-white/20 mt-2">
          {/* Mic button */}
          <MicButton
            isListening={session.isListening}
            disabled={!supported || session.quotaExhausted}
            onStart={startListening}
            onStop={stopListening}
          />

          {/* Status indicators */}
          <div className="flex-1 flex flex-col gap-0.5">
            {session.isListening && (
              <span className="text-sm font-medium text-red-500 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse inline-block" />
                Listening…
              </span>
            )}
            {session.isProcessing && !session.isListening && (
              <span className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                <span className="w-4 h-4 border-2 border-gray-300 border-t-violet-500 rounded-full animate-spin inline-block" />
                Processing…
              </span>
            )}
            {session.isProcessing && session.isListening && (
              <span className="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-1">
                <span className="w-3 h-3 border border-gray-300 border-t-violet-400 rounded-full animate-spin inline-block" />
                Processing…
              </span>
            )}
            {!session.isListening && !session.isProcessing && confirmedCount === 0 && visibleCandidates.length > 0 && (
              <span className="text-xs text-gray-400 dark:text-gray-500">
                Select tasks to save
              </span>
            )}
          </div>

          {/* Save button */}
          <button
            type="button"
            onClick={save}
            disabled={confirmedCount === 0 || session.isProcessing}
            className={[
              "px-4 py-2 rounded-xl text-sm font-semibold transition-all duration-150",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-violet-500",
              confirmedCount > 0 && !session.isProcessing
                ? "bg-violet-600 hover:bg-violet-700 text-white shadow-sm"
                : "bg-gray-100 dark:bg-gray-800 text-gray-400 cursor-not-allowed",
            ].join(" ")}
          >
            {saveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default VoiceDictationModal;
