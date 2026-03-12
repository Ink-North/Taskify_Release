import React, { useState } from "react";

type GeneratedBackup = {
  nsec: string;
};

type AgentModeOnboardingProps = {
  onUseExistingKey: (value: string) => boolean;
  onGenerateNewKey: () => GeneratedBackup | null;
  onComplete: () => void;
};

export function AgentModeOnboarding({
  onUseExistingKey,
  onGenerateNewKey,
  onComplete,
}: AgentModeOnboardingProps) {
  const [existingKeyInput, setExistingKeyInput] = useState("");
  const [createdNsec, setCreatedNsec] = useState("");
  const [keyMessage, setKeyMessage] = useState<string | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);

  const handleUseExistingKey = () => {
    setKeyError(null);
    setKeyMessage(null);
    const trimmed = existingKeyInput.trim();
    if (!trimmed) {
      setKeyError("Enter your nsec first.");
      return;
    }
    const ok = onUseExistingKey(trimmed);
    if (!ok) {
      setKeyError("That key looks invalid. Paste a valid nsec or 64-character secret key.");
      return;
    }
    setKeyMessage("Signed in with existing key.");
  };

  const handleGenerateKey = () => {
    setKeyError(null);
    setKeyMessage(null);
    const generated = onGenerateNewKey();
    if (!generated) {
      setKeyError("Unable to generate a key right now. Try again.");
      return;
    }
    setCreatedNsec(generated.nsec);
    setKeyMessage("New key generated and applied.");
  };

  const copyValue = async (value: string, label: string) => {
    if (!value) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(value);
      setKeyMessage(`${label} copied`);
    } catch {
      setKeyMessage(`Unable to copy ${label.toLowerCase()} on this device`);
    }
  };

  return (
    <div className="space-y-4 text-sm text-secondary">
      <p className="text-primary">
        Agent mode is enabled for this session. This adds a JSON command interface intended for automation.
      </p>

      <div className="rounded-xl border border-surface bg-surface-muted p-3 space-y-2">
        <div className="text-xs uppercase tracking-wide text-secondary">Nostr key setup</div>
        <p>Choose one:</p>
        <div className="space-y-2">
          <input
            className="pill-input w-full"
            placeholder="nsec1... or 64-character key"
            value={existingKeyInput}
            onChange={(event) => setExistingKeyInput(event.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="ghost-button button-sm pressable"
              onClick={handleUseExistingKey}
            >
              Sign in with existing key
            </button>
            <button
              type="button"
              className="ghost-button button-sm pressable"
              onClick={handleGenerateKey}
            >
              Generate new key
            </button>
          </div>
        </div>
        {createdNsec ? (
          <div className="rounded-lg border border-surface p-2 text-xs text-primary break-all space-y-2">
            <div><strong>New nsec:</strong> {createdNsec}</div>
            <button
              type="button"
              className="ghost-button button-sm pressable"
              onClick={() => copyValue(createdNsec, "nsec")}
            >
              Copy nsec
            </button>
          </div>
        ) : null}
        {keyError ? <div className="text-xs text-rose-400">{keyError}</div> : null}
        {keyMessage ? <div className="text-xs text-emerald-300">{keyMessage}</div> : null}
      </div>

      <div className="rounded-xl border border-surface bg-surface-muted p-3 space-y-2">
        <div className="text-xs uppercase tracking-wide text-secondary">Quick start</div>
        <ul className="list-disc pl-5 space-y-1">
          <li>Open the <strong>Agent</strong> panel and run <code>meta.help</code>.</li>
          <li>Use template buttons for common commands.</li>
          <li>Set security to <strong>Moderate</strong> or <strong>Strict</strong> before autonomous use.</li>
          <li>Add trusted npubs to unlock strict filtering.</li>
        </ul>
        <button
          type="button"
          className="ghost-button button-sm pressable"
          onClick={() => window.dispatchEvent(new CustomEvent("taskify:agent-run-help"))}
        >
          Run first command (meta.help)
        </button>
      </div>

      <div className="rounded-xl border border-surface bg-surface-muted p-3 space-y-2">
        <div className="text-xs uppercase tracking-wide text-secondary">Safety note</div>
        <p>
          In strict mode with zero trusted npubs, list results will be empty by design.
        </p>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          className="accent-button button-sm pressable"
          onClick={onComplete}
        >
          Got it
        </button>
      </div>
    </div>
  );
}
