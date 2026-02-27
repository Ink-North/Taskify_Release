import React, { useCallback, useState } from "react";
import { dispatchAgentCommand, type AgentResponseV1 } from "../../agent/agentDispatcher";
import {
  isLooselyValidTrustedNpub,
  type AgentSecurityConfig,
  type AgentSecurityMode,
} from "../../agent/agentSecurity";
import { useToast } from "../../context/ToastContext";
import { Modal } from "../Modal";
import { TASKIFY_AGENT_CONTRACT_BLOCK } from "./agentPromptContract";

const DEFAULT_COMMAND = JSON.stringify(
  {
    v: 1,
    id: "help-1",
    op: "meta.help",
    params: {},
  },
  null,
  2,
);

function securityModeNote(mode: AgentSecurityMode): string {
  if (mode === "strict") return "Only trusted items returned";
  if (mode === "off") return "No filtering";
  return "Untrusted items returned with agentSafe=false";
}

function formatResponse(response: AgentResponseV1 | null): string {
  if (!response) return "";
  return JSON.stringify(response, null, 2);
}

export function AgentModePanel({
  securityConfig,
  onUpdateSecurityConfig,
  onAddTrustedNpub,
  onRemoveTrustedNpub,
  onClearTrustedNpubs,
  onClose,
}: {
  securityConfig: AgentSecurityConfig;
  onUpdateSecurityConfig: (
    updates: Partial<Pick<AgentSecurityConfig, "enabled" | "mode">>,
  ) => void;
  onAddTrustedNpub: (npub: string) => void;
  onRemoveTrustedNpub: (npub: string) => void;
  onClearTrustedNpubs: () => void;
  onClose: () => void;
}) {
  const { show: showToast } = useToast();
  const [commandInput, setCommandInput] = useState(DEFAULT_COMMAND);
  const [status, setStatus] = useState<"idle" | "running">("idle");
  const [lastResponse, setLastResponse] = useState<AgentResponseV1 | null>(null);
  const [trustInput, setTrustInput] = useState("");

  const handleExecute = useCallback(async () => {
    setStatus("running");
    try {
      const response = await dispatchAgentCommand(commandInput);
      setLastResponse(response);
    } catch (error: any) {
      setLastResponse({
        v: 1,
        id: null,
        ok: false,
        result: null,
        error: {
          code: "INTERNAL",
          message: error?.message || "Internal error",
        },
      });
    } finally {
      setStatus("idle");
    }
  }, [commandInput]);

  const handleCopyContract = useCallback(async () => {
    try {
      await navigator.clipboard?.writeText(TASKIFY_AGENT_CONTRACT_BLOCK);
      showToast("Taskify agent contract copied", 2000);
    } catch {
      showToast("Unable to copy contract", 2000);
    }
  }, [showToast]);

  const handleAddTrustedNpub = useCallback(() => {
    const normalized = trustInput.trim().toLowerCase();
    if (!normalized) return;
    if (!isLooselyValidTrustedNpub(normalized)) {
      showToast('Trusted npub must start with "npub1"', 2000);
      return;
    }
    onAddTrustedNpub(normalized);
    setTrustInput("");
    showToast("Trusted npub added", 2000);
  }, [onAddTrustedNpub, showToast, trustInput]);

  return (
    <Modal
      onClose={onClose}
      title="Agent Mode"
      variant="fullscreen"
      actions={
        <>
          <div
            className="agent-panel__status agent-panel__status--neutral"
            data-agent="status"
          >
            {status}
          </div>
          <button
            type="button"
            className="ghost-button button-sm pressable"
            onClick={handleCopyContract}
          >
            Copy contract
          </button>
          <button
            type="button"
            className="accent-button button-sm pressable"
            data-agent="execute"
            onClick={handleExecute}
          >
            Execute
          </button>
        </>
      }
    >
      <div className="agent-panel">
        <section className="agent-panel__section">
          <div className="agent-panel__label">
            Command
            <span className="agent-panel__hint">strict JSON envelope</span>
          </div>
          <div className="text-xs text-secondary">
            Use a single JSON object with `v`, `id`, `op`, and `params`. Positive integer versions are accepted. Start with `meta.help` to learn supported operations.
          </div>
          <textarea
            className="agent-panel__surface agent-panel__input"
            data-agent="command-input"
            value={commandInput}
            onChange={(event) => setCommandInput(event.target.value)}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
          />
        </section>

        <section className="agent-panel__section">
          <div className="agent-panel__label">Result</div>
          <textarea
            readOnly
            className="agent-panel__surface agent-panel__output"
            data-agent="result-output"
            value={formatResponse(lastResponse)}
            spellCheck={false}
          />
        </section>

        <section className="agent-panel__section">
          <div className="agent-panel__label">Security</div>
          <div className="agent-panel__security-note">
            {securityModeNote(securityConfig.mode)}
          </div>
          <div className="agent-panel__security-grid">
            <label className="agent-panel__security-field">
              <span className="text-xs text-secondary">Enabled</span>
              <input
                type="checkbox"
                data-agent="security-enabled"
                checked={securityConfig.enabled}
                onChange={(event) =>
                  onUpdateSecurityConfig({ enabled: event.target.checked })
                }
              />
            </label>
            <label className="agent-panel__security-field">
              <span className="text-xs text-secondary">Mode</span>
              <select
                className="agent-panel__control"
                data-agent="security-mode"
                value={securityConfig.mode}
                onChange={(event) =>
                  onUpdateSecurityConfig({
                    mode: event.target.value as AgentSecurityMode,
                  })
                }
              >
                <option value="off">Off</option>
                <option value="moderate">Moderate</option>
                <option value="strict">Strict</option>
              </select>
            </label>
          </div>

          <div className="agent-panel__trust-row">
            <input
              className="agent-panel__control agent-panel__control--mono flex-1"
              data-agent="trust-input"
              placeholder="npub1..."
              value={trustInput}
              onChange={(event) => setTrustInput(event.target.value)}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
            <button
              type="button"
              className="accent-button button-sm pressable"
              data-agent="trust-add"
              onClick={handleAddTrustedNpub}
            >
              Add
            </button>
            <button
              type="button"
              className="ghost-button button-sm pressable"
              onClick={onClearTrustedNpubs}
              disabled={securityConfig.trustedNpubs.length === 0}
            >
              Clear
            </button>
          </div>

          <div className="agent-panel__trust-list" data-agent="trust-list">
            {securityConfig.trustedNpubs.length === 0 ? (
              <div className="text-xs text-secondary">No trusted npubs configured.</div>
            ) : (
              securityConfig.trustedNpubs.map((npub) => (
                <div key={npub} className="agent-panel__trust-item">
                  <code>{npub}</code>
                  <button
                    type="button"
                    className="ghost-button button-sm pressable"
                    onClick={() => onRemoveTrustedNpub(npub)}
                  >
                    Remove
                  </button>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </Modal>
  );
}
