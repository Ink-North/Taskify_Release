// @ts-nocheck
import React, { useState, useCallback, useEffect, useMemo } from "react";
import { nip19 } from "nostr-tools";
import { kvStorage } from "../../storage/kvStorage";
import { LS_NOSTR_SK } from "../../nostrKeys";
import { DEFAULT_NOSTR_RELAYS } from "../../lib/relays";
import { DEFAULT_FILE_STORAGE_SERVER, normalizeFileServerUrl } from "../../lib/fileStorage";
import { publishFileServerPreference } from "../../nostr/ProfilePublisher";
import { toNsec } from "../../domains/nostr/nostrKeyUtils";
import type { Settings } from "../../domains/tasks/settingsTypes";
import { useToast } from "../../context/ToastContext";
import { pillButtonClass } from "./settingsConstants";

export function NostrSection({
  settings,
  setSettings,
  defaultRelays,
  setDefaultRelays,
  pubkeyHex,
  onGenerateKey,
  onSetKey,
  showAdvanced,
  setShowAdvanced,
}: {
  settings: Settings;
  setSettings: (s: Partial<Settings>) => void;
  defaultRelays: string[];
  setDefaultRelays: (rls: string[]) => void;
  pubkeyHex: string;
  onGenerateKey: () => void;
  onSetKey: (hex: string) => void;
  showAdvanced: boolean;
  setShowAdvanced: (fn: (prev: boolean) => boolean) => void;
}) {
  const { show: showToast } = useToast();
  const [customSk, setCustomSk] = useState("");
  const [newDefaultRelay, setNewDefaultRelay] = useState("");
  const [fileServerInput, setFileServerInput] = useState(
    settings.fileStorageServer || DEFAULT_FILE_STORAGE_SERVER,
  );
  const [fileServerStatus, setFileServerStatus] = useState<string | null>(null);
  const [fileServerSaving, setFileServerSaving] = useState(false);

  const pubkeyNpub = useMemo(() => {
    const trimmed = (pubkeyHex || "").trim();
    if (!trimmed) return "";
    try {
      if (typeof (nip19 as any)?.npubEncode === "function") {
        return (nip19 as any).npubEncode(trimmed);
      }
    } catch {}
    return trimmed;
  }, [pubkeyHex]);

  useEffect(() => {
    setFileServerInput(settings.fileStorageServer || DEFAULT_FILE_STORAGE_SERVER);
  }, [settings.fileStorageServer]);

  const readNostrSecret = useCallback((): string | null => {
    try {
      const raw = kvStorage.getItem(LS_NOSTR_SK);
      if (raw && /^[0-9a-fA-F]{64}$/.test(raw.trim())) {
        return raw.trim().toLowerCase();
      }
    } catch {}
    return null;
  }, []);

  const handleSaveFileServer = useCallback(async () => {
    const normalized = normalizeFileServerUrl(fileServerInput);
    if (!normalized && fileServerInput.trim()) {
      setFileServerStatus("Enter a valid file storage server URL (e.g., https://nostr.build).");
      return;
    }
    const targetServer = normalized || DEFAULT_FILE_STORAGE_SERVER;
    setFileServerSaving(true);
    setFileServerStatus(null);
    try {
      setSettings({ fileStorageServer: targetServer });
      setFileServerInput(targetServer);
      const secret = readNostrSecret();
      if (!secret) {
        setFileServerStatus("Add your Nostr private key first.");
        return;
      }
      const relayList = (defaultRelays.length ? defaultRelays : Array.from(DEFAULT_NOSTR_RELAYS))
        .map((r) => r.trim())
        .filter(Boolean);
      if (!relayList.length) {
        setFileServerStatus("Add at least one relay to publish your file server.");
        return;
      }
      await publishFileServerPreference([targetServer], { relays: relayList, signer: secret });
      setFileServerStatus("Published file storage server");
      showToast("File storage server saved", 2000);
    } catch (error: any) {
      setFileServerStatus(error?.message || "Unable to save file storage server.");
    } finally {
      setFileServerSaving(false);
    }
  }, [defaultRelays, fileServerInput, readNostrSecret, setSettings, showToast]);

  return (
    <section className="wallet-section space-y-3">
      <div className="flex items-center gap-2 mb-3">
        <div className="text-sm font-medium">Nostr</div>
        <div className="ml-auto" />
        <button
          className="ghost-button button-sm pressable"
          onClick={()=>setShowAdvanced(a=>!a)}
        >{showAdvanced ? "Hide advanced" : "Advanced"}</button>
      </div>
      {/* Quick actions available outside Advanced */}
      <div className="mb-3 flex gap-2">
        <button
          className="ghost-button button-sm pressable"
          onClick={async ()=>{
            try {
              const sk = kvStorage.getItem(LS_NOSTR_SK) || "";
              if (!sk) return;
              await navigator.clipboard?.writeText(toNsec(sk));
            } catch {}
          }}
        >Copy nsec</button>
        <button
          className="ghost-button button-sm pressable"
          onClick={()=>setDefaultRelays(DEFAULT_NOSTR_RELAYS.slice())}
        >Reload default relays</button>
      </div>
      {showAdvanced && (
        <>
          <div className="mb-3">
            <div className="text-sm font-medium mb-1">Encrypted sync backup</div>
            <div className="flex gap-2">
              <button
                className={pillButtonClass(settings.nostrBackupEnabled)}
                onClick={() => setSettings({ nostrBackupEnabled: true })}
              >
                On
              </button>
              <button
                className={pillButtonClass(!settings.nostrBackupEnabled)}
                onClick={() => setSettings({ nostrBackupEnabled: false })}
              >
                Off
              </button>
            </div>
          </div>
          {/* Public key */}
          <div className="mb-3">
            <div className="text-xs text-secondary mb-1">Your Nostr public key (npub)</div>
            <div className="flex gap-2 items-center">
              <input readOnly value={pubkeyNpub || "(generating…)"}
                     className="pill-input flex-1"/>
              <button className="ghost-button button-sm pressable" onClick={async ()=>{ if(pubkeyNpub) { try { await navigator.clipboard?.writeText(pubkeyNpub); } catch {} } }}>Copy</button>
            </div>
          </div>

          {/* Private key options */}
          <div className="mb-3 space-y-2">
            <div className="text-xs text-secondary mb-1">Custom Nostr private key (hex or nsec)</div>
            <div className="flex gap-2 items-center">
              <input value={customSk} onChange={e=>setCustomSk(e.target.value)}
                     className="pill-input flex-1" placeholder="nsec or hex"/>
              <button className="ghost-button button-sm pressable" onClick={()=>{onSetKey(customSk); setCustomSk('');}}>Use</button>
            </div>
            <div className="flex gap-2">
              <button className="ghost-button button-sm pressable" onClick={onGenerateKey}>Generate new key</button>
              <button
                className="ghost-button button-sm pressable"
                onClick={async ()=>{
                  try {
                    const sk = kvStorage.getItem(LS_NOSTR_SK) || "";
                    if (!sk) return;
                    await navigator.clipboard?.writeText(toNsec(sk));
                  } catch {}
                }}
              >Copy private key (nsec)</button>
            </div>
          </div>

          {/* File storage server */}
          <div className="mb-3">
            <div className="text-xs text-secondary mb-1">File storage server</div>
            <div className="flex gap-2 mb-1">
              <input
                className="pill-input flex-1"
                value={fileServerInput}
                onChange={(e)=>setFileServerInput(e.target.value)}
                placeholder={DEFAULT_FILE_STORAGE_SERVER}
              />
              <button
                className="ghost-button button-sm pressable"
                onClick={handleSaveFileServer}
                disabled={fileServerSaving}
              >
                {fileServerSaving ? "Saving…" : "Save"}
              </button>
            </div>
            <div className="text-xs text-secondary">
              Used for profile photo uploads (NIP-96). Default: {DEFAULT_FILE_STORAGE_SERVER}
            </div>
            {fileServerStatus && (
              <div className="text-xs text-secondary mt-1">{fileServerStatus}</div>
            )}
          </div>

          {/* Default relays */}
          <div className="mb-3">
            <div className="text-xs text-secondary mb-1">Default relays</div>
            <div className="flex gap-2 mb-2">
              <input
                value={newDefaultRelay}
                onChange={(e)=>setNewDefaultRelay(e.target.value)}
                onKeyDown={(e)=>{ if (e.key === 'Enter') { const v = newDefaultRelay.trim(); if (v && !defaultRelays.includes(v)) { setDefaultRelays([...defaultRelays, v]); setNewDefaultRelay(""); } } }}
                className="pill-input flex-1"
                placeholder="wss://relay.example"
              />
              <button
                className="ghost-button button-sm pressable"
                onClick={()=>{ const v = newDefaultRelay.trim(); if (v && !defaultRelays.includes(v)) { setDefaultRelays([...defaultRelays, v]); setNewDefaultRelay(""); } }}
              >Add</button>
            </div>
            <ul className="space-y-2">
              {defaultRelays.map((r) => (
                <li key={r} className="p-2 rounded-lg bg-surface-muted border border-surface flex items-center gap-2">
                  <div className="flex-1 truncate">{r}</div>
                  <button className="ghost-button button-sm pressable text-rose-400" onClick={()=>setDefaultRelays(defaultRelays.filter(x => x !== r))}>Delete</button>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex gap-2">
              <button
                className="ghost-button button-sm pressable"
                onClick={()=>setDefaultRelays(DEFAULT_NOSTR_RELAYS.slice())}
              >Reload defaults</button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
