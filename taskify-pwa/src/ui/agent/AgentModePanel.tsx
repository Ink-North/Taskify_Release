import React, { useCallback, useEffect, useMemo, useState } from "react";
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
  { v: 1, id: "help-1", op: "meta.help", params: {} },
  null,
  2,
);

type CommandTemplate = { label: string; command: object };
type RunMeta = { tookMs: number; code: string; ok: boolean; atISO: string } | null;

const COMMAND_TEMPLATES: CommandTemplate[] = [
  { label: "Help", command: { v: 1, id: "help-1", op: "meta.help", params: {} } },
  { label: "List open", command: { v: 1, id: "list-1", op: "task.list", params: { status: "open", limit: 25 } } },
  {
    label: "Create task",
    command: {
      v: 1,
      id: "create-1",
      op: "task.create",
      params: { title: "Example task", note: "", priority: 2, idempotencyKey: "example-task-1" },
    },
  },
  { label: "Security status", command: { v: 1, id: "sec-get-1", op: "agent.security.get", params: {} } },
  {
    label: "Set strict",
    command: { v: 1, id: "sec-set-1", op: "agent.security.set", params: { enabled: true, mode: "strict" } },
  },
];

function securityModeNote(mode: AgentSecurityMode): string {
  if (mode === "strict") return "Only trusted items returned";
  if (mode === "off") return "No filtering";
  return "Untrusted items returned with agentSafe=false";
}

function securityBannerText(config: AgentSecurityConfig): string | null {
  if (!config.enabled) {
    return "Security is disabled. Untrusted task data may appear in results.";
  }
  if (config.mode === "strict" && config.trustedNpubs.length === 0) {
    return "Strict mode + no trusted npubs: list results will be empty until trust is configured.";
  }
  if (config.mode === "moderate") {
    return "Moderate mode returns all items and labels trust with agentSafe flags.";
  }
  return null;
}

function formatResponse(response: AgentResponseV1 | null, pretty: boolean): string {
  if (!response) return "";
  return JSON.stringify(response, null, pretty ? 2 : 0);
}

function validateCommandEnvelope(raw: string): string | null {
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return "Invalid JSON";
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "Command must be a JSON object";
  if (!(Number.isInteger(parsed.v) && parsed.v > 0) && !(Number.isInteger(parsed.version) && parsed.version > 0)) {
    return "Missing version: provide positive integer v (or version)";
  }
  if (typeof parsed.id !== "string" || !parsed.id.trim()) return "Missing id string";
  if (typeof parsed.op !== "string" || !parsed.op.trim()) return "Missing op string";
  if (parsed.params === undefined || parsed.params === null || typeof parsed.params !== "object" || Array.isArray(parsed.params)) {
    return "params must be an object";
  }
  return null;
}

export function AgentModePanel({
  securityConfig,
  onUpdateSecurityConfig,
  onAddTrustedNpub,
  onSetStrictWithTrustedNpub,
  onRemoveTrustedNpub,
  onClearTrustedNpubs,
  onClose,
}: {
  securityConfig: AgentSecurityConfig;
  onUpdateSecurityConfig: (updates: Partial<Pick<AgentSecurityConfig, "enabled" | "mode">>) => void;
  onAddTrustedNpub: (npub: string) => void;
  onSetStrictWithTrustedNpub: (npub: string) => void;
  onRemoveTrustedNpub: (npub: string) => void;
  onClearTrustedNpubs: () => void;
  onClose: () => void;
}) {
  const { show: showToast } = useToast();
  const [commandInput, setCommandInput] = useState(DEFAULT_COMMAND);
  const [status, setStatus] = useState<"idle" | "running">("idle");
  const [lastResponse, setLastResponse] = useState<AgentResponseV1 | null>(null);
  const [runMeta, setRunMeta] = useState<RunMeta>(null);
  const [trustInput, setTrustInput] = useState("");
  const [prettyResult, setPrettyResult] = useState(true);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);

  const resultText = useMemo(() => formatResponse(lastResponse, prettyResult), [lastResponse, prettyResult]);
  const visibleResultText = status === "running" ? "Running command…" : resultText;
  const runMetaLabel = useMemo(() => {
    if (!runMeta) return "no response yet";
    const when = new Date(runMeta.atISO).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    return `${runMeta.code} • ${runMeta.tookMs}ms • ${when}`;
  }, [runMeta]);
  const bannerText = securityBannerText(securityConfig);

  const pushHistory = useCallback((command: string) => {
    setHistory((prev) => {
      const trimmed = command.trim();
      if (!trimmed) return prev;
      if (prev[0] === trimmed) return prev;
      return [trimmed, ...prev].slice(0, 20);
    });
    setHistoryIndex(-1);
  }, []);

  const runCommand = useCallback(async () => {
    const validationError = validateCommandEnvelope(commandInput);
    if (validationError) {
      const response: AgentResponseV1 = {
        v: 1,
        id: null,
        ok: false,
        result: null,
        error: { code: "VALIDATION", message: validationError },
      };
      setLastResponse(response);
      setRunMeta({ tookMs: 0, code: "VALIDATION", ok: false, atISO: new Date().toISOString() });
      return;
    }

    setStatus("running");
    setLastResponse(null);
    const started = performance.now();
    try {
      const response = await dispatchAgentCommand(commandInput);
      setLastResponse(response);
      setRunMeta({
        tookMs: Math.round(performance.now() - started),
        code: response.ok ? "OK" : response.error?.code || "ERROR",
        ok: !!response.ok,
        atISO: new Date().toISOString(),
      });
      pushHistory(commandInput);
    } catch (error: any) {
      const response: AgentResponseV1 = {
        v: 1,
        id: null,
        ok: false,
        result: null,
        error: { code: "INTERNAL", message: error?.message || "Internal error" },
      };
      setLastResponse(response);
      setRunMeta({ tookMs: Math.round(performance.now() - started), code: "INTERNAL", ok: false, atISO: new Date().toISOString() });
    } finally {
      setStatus("idle");
    }
  }, [commandInput, pushHistory]);

  const handleCopyContract = useCallback(async () => {
    try {
      await navigator.clipboard?.writeText(TASKIFY_AGENT_CONTRACT_BLOCK);
      showToast("Taskify agent contract copied", 2000);
    } catch {
      showToast("Unable to copy contract", 2000);
    }
  }, [showToast]);

  const handleCopyResult = useCallback(async () => {
    if (!resultText.trim()) return;
    try {
      await navigator.clipboard?.writeText(resultText);
      showToast("Result copied", 1800);
    } catch {
      showToast("Unable to copy result", 1800);
    }
  }, [resultText, showToast]);

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

  const handleUseStrictWizard = useCallback(() => {
    const normalized = trustInput.trim().toLowerCase();
    if (!isLooselyValidTrustedNpub(normalized)) {
      showToast("Enter a valid npub first", 1800);
      return;
    }
    onSetStrictWithTrustedNpub(normalized);
    setTrustInput("");
    showToast("Strict mode enabled + trusted npub added", 2000);
  }, [onSetStrictWithTrustedNpub, showToast, trustInput]);

  const handleSelectTemplate = useCallback((template: CommandTemplate) => {
    setCommandInput(JSON.stringify(template.command, null, 2));
  }, []);

  useEffect(() => {
    const onRunHelp = () => {
      setCommandInput(DEFAULT_COMMAND);
      window.setTimeout(() => {
        void runCommand();
      }, 0);
    };
    window.addEventListener("taskify:agent-run-help", onRunHelp);
    return () => window.removeEventListener("taskify:agent-run-help", onRunHelp);
  }, [runCommand]);

  return (
    <Modal
      onClose={onClose}
      title="Agent Mode"
      variant="fullscreen"
      actions={
        <>
          <div className="agent-panel__status agent-panel__status--neutral" data-agent="status">{status}</div>
          <button type="button" className="ghost-button button-sm pressable" onClick={handleCopyContract}>
            Copy contract
          </button>
          <button
            type="button"
            className="accent-button button-sm pressable"
            data-agent="execute"
            onClick={runCommand}
            disabled={status === "running"}
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
            <span className="agent-panel__hint">strict JSON envelope • ⌘/Ctrl+Enter run • ↑/↓ history</span>
          </div>
          <div className="text-xs text-secondary">
            Use one JSON object with `v`, `id`, `op`, and `params`. Start with `meta.help`.
          </div>
          <div className="agent-panel__actions">
            {COMMAND_TEMPLATES.map((template) => (
              <button key={template.label} type="button" className="ghost-button button-sm pressable" onClick={() => handleSelectTemplate(template)}>
                {template.label}
              </button>
            ))}
          </div>
          <textarea
            className="agent-panel__surface agent-panel__input"
            data-agent="command-input"
            value={commandInput}
            onChange={(event) => {
              setCommandInput(event.target.value);
              setHistoryIndex(-1);
            }}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                runCommand();
                return;
              }
              if (event.key === "ArrowUp" && !event.shiftKey) {
                if (!history.length) return;
                event.preventDefault();
                setHistoryIndex((prev) => {
                  const next = Math.min(prev + 1, history.length - 1);
                  setCommandInput(history[next]);
                  return next;
                });
                return;
              }
              if (event.key === "ArrowDown" && !event.shiftKey) {
                if (!history.length) return;
                event.preventDefault();
                setHistoryIndex((prev) => {
                  const next = Math.max(prev - 1, -1);
                  setCommandInput(next === -1 ? DEFAULT_COMMAND : history[next]);
                  return next;
                });
              }
            }}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
          />
        </section>

        <section className="agent-panel__section">
          <div className="agent-panel__label">
            Result
            <span className="agent-panel__hint">{runMetaLabel}</span>
          </div>
          <div className="agent-panel__actions">
            <button type="button" className="ghost-button button-sm pressable" onClick={() => setPrettyResult((v) => !v)}>
              {prettyResult ? "Compact" : "Pretty"}
            </button>
            <button type="button" className="ghost-button button-sm pressable" onClick={handleCopyResult} disabled={!resultText.trim() || status === "running"}>
              Copy result
            </button>
          </div>
          <textarea
            readOnly
            className="agent-panel__surface agent-panel__output"
            data-agent="result-output"
            value={visibleResultText}
            spellCheck={false}
          />
        </section>

        <section className="agent-panel__section">
          <div className="agent-panel__label">Security</div>
          <div className="agent-panel__security-note">{securityModeNote(securityConfig.mode)}</div>
          {bannerText ? <div className="agent-panel__banner" data-level={securityConfig.enabled ? "info" : "warn"}>{bannerText}</div> : null}
          <div className="agent-panel__security-grid">
            <label className="agent-panel__security-field">
              <span className="text-xs text-secondary">Enabled</span>
              <input
                type="checkbox"
                data-agent="security-enabled"
                checked={securityConfig.enabled}
                onChange={(event) => onUpdateSecurityConfig({ enabled: event.target.checked })}
              />
            </label>
            <label className="agent-panel__security-field">
              <span className="text-xs text-secondary">Mode</span>
              <select
                className="agent-panel__control"
                data-agent="security-mode"
                value={securityConfig.mode}
                onChange={(event) => onUpdateSecurityConfig({ mode: event.target.value as AgentSecurityMode })}
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
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  handleAddTrustedNpub();
                }
              }}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
            <button type="button" className="accent-button button-sm pressable" data-agent="trust-add" onClick={handleAddTrustedNpub}>
              Add
            </button>
            <button type="button" className="ghost-button button-sm pressable" onClick={handleUseStrictWizard}>
              Strict + trust
            </button>
            <button type="button" className="ghost-button button-sm pressable" onClick={onClearTrustedNpubs} disabled={securityConfig.trustedNpubs.length === 0}>
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
                  <button type="button" className="ghost-button button-sm pressable" onClick={() => onRemoveTrustedNpub(npub)}>
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
