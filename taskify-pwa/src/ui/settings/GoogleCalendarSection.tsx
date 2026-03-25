import React from "react";
import type { GcalCalendar, GcalConnectionStatus } from "../../hooks/useGoogleCalendar";
import { pillButtonClass } from "./settingsConstants";

type Props = {
  connectionStatus: GcalConnectionStatus;
  calendars: GcalCalendar[];
  loading: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onToggleCalendar: (id: string, selected: boolean) => void;
  onSync: () => void;
};

export function GoogleCalendarSection({
  connectionStatus,
  calendars,
  loading,
  onConnect,
  onDisconnect,
  onToggleCalendar,
  onSync,
}: Props) {
  const connected = connectionStatus.connected;
  const status = connected ? connectionStatus.status : null;
  const needsReauth = status === "needs_reauth" || status === "token_expired";

  const formatLastSync = (ts: number | null) => {
    if (!ts) return "Never";
    const diff = Math.floor((Date.now() / 1000) - ts);
    if (diff < 60) return "Just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  };

  return (
    <section className="wallet-section space-y-3">
      <div className="flex items-center gap-2">
        <div className="text-sm font-medium">Connected Calendars</div>
      </div>

      {!connected ? (
        <div className="space-y-2">
          <p className="text-xs text-secondary">
            Connect Google Calendar to see your events alongside tasks in the Upcoming view.
          </p>
          <button
            type="button"
            className={pillButtonClass}
            onClick={onConnect}
            disabled={loading}
          >
            {loading ? "Connecting…" : "Connect Google Calendar"}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Account info + status */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs text-secondary truncate max-w-[60%]">
                {connectionStatus.googleEmail}
              </span>
              {needsReauth ? (
                <span className="text-xs text-red-400">Reconnect required</span>
              ) : status === "sync_failed" ? (
                <span className="text-xs text-yellow-400">Sync failed</span>
              ) : (
                <span className="text-xs text-secondary">
                  Synced {formatLastSync(connectionStatus.lastSyncAt)}
                </span>
              )}
            </div>
            {connectionStatus.lastError && (
              <div className="text-xs text-red-400 truncate">{connectionStatus.lastError}</div>
            )}
          </div>

          {/* Calendar toggles */}
          {calendars.length > 0 && (
            <div className="space-y-1">
              <div className="text-xs text-secondary mb-1">Calendars</div>
              {calendars.map((cal) => (
                <label
                  key={cal.id}
                  className="flex items-center gap-2 cursor-pointer py-0.5"
                >
                  <input
                    type="checkbox"
                    checked={cal.selected === 1}
                    onChange={(e) => onToggleCalendar(cal.id, e.target.checked)}
                    className="rounded"
                  />
                  {cal.color && (
                    <span
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: cal.color }}
                    />
                  )}
                  <span className="text-sm truncate">{cal.name}</span>
                  {cal.primary_cal === 1 && (
                    <span className="text-xs text-secondary ml-auto flex-shrink-0">Primary</span>
                  )}
                </label>
              ))}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 flex-wrap">
            {needsReauth ? (
              <button
                type="button"
                className={pillButtonClass}
                onClick={onConnect}
                disabled={loading}
              >
                Reconnect
              </button>
            ) : (
              <button
                type="button"
                className={pillButtonClass}
                onClick={onSync}
                disabled={loading}
              >
                {loading ? "Syncing…" : "Sync now"}
              </button>
            )}
            <button
              type="button"
              className={`${pillButtonClass} text-red-400`}
              onClick={onDisconnect}
              disabled={loading}
            >
              Disconnect
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
