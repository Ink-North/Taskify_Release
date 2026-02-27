import { useState, useCallback, useEffect, useMemo } from "react";
import type { TimeZoneOption } from "../../domains/dateTime/timezoneUtils";
import { scoreTimeZoneOption } from "../../domains/dateTime/timezoneUtils";
import { normalizeTimeZone, resolveSystemTimeZone } from "../../domains/dateTime/dateUtils";
import { ActionSheet } from "../../components/ActionSheet";

function TimeZoneSheet({
  open,
  onClose,
  options,
  selectedTimeZone,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  options: TimeZoneOption[];
  selectedTimeZone: string;
  onSelect: (timeZone: string) => void;
}) {
  const [query, setQuery] = useState("");
  const normalizedSelected = normalizeTimeZone(selectedTimeZone) ?? resolveSystemTimeZone();
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!normalizedQuery) return options;
    return options
      .filter((option) => option.search.includes(normalizedQuery))
      .map((option) => ({ option, score: scoreTimeZoneOption(option, normalizedQuery) }))
      .sort((a, b) => {
        if (a.score !== b.score) return a.score - b.score;
        if (a.option.offsetMinutes !== b.option.offsetMinutes) {
          return a.option.offsetMinutes - b.option.offsetMinutes;
        }
        return a.option.label.localeCompare(b.option.label);
      })
      .map((entry) => entry.option);
  }, [normalizedQuery, options]);

  useEffect(() => {
    if (!open) {
      setQuery("");
    }
  }, [open]);

  const handleSelect = useCallback(
    (timeZone: string) => {
      onSelect(timeZone);
      onClose();
    },
    [onClose, onSelect],
  );

  return (
    <ActionSheet open={open} onClose={onClose} title="Time Zone" stackLevel={80} panelClassName="sheet-panel--tall">
      <div className="wallet-section space-y-4 text-sm">
        <div className="space-y-2">
          <input
            type="search"
            className="pill-input w-full"
            placeholder="Search by city, abbreviation, or name"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          {filtered.length ? (
            filtered.map((option) => {
              const isSelected = option.id === normalizedSelected;
              const longLabel = option.longNames[0] || option.region || option.id;
              const shortLabel = option.shortNames.find((name) => name && name !== longLabel) || "";
              const metaParts = [
                longLabel,
                shortLabel && shortLabel !== longLabel ? shortLabel : "",
                option.offsetLabel,
              ].filter(Boolean);
              const metaLabel = metaParts.join(" • ");
              return (
                <button
                  key={option.id}
                  type="button"
                  className={`w-full text-left rounded-2xl border border-surface bg-surface p-3 ${isSelected ? "ring-2 ring-accent/50" : "pressable"}`}
                  onClick={() => handleSelect(option.id)}
                  disabled={isSelected}
                  aria-pressed={isSelected}
                  title={option.id}
                >
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="font-semibold truncate">{option.label}</div>
                        {isSelected && <div className="text-[11px] font-semibold text-accent">Selected</div>}
                      </div>
                      <div className="text-[11px] text-secondary truncate">{metaLabel}</div>
                    </div>
                    <span className="text-secondary">›</span>
                  </div>
                </button>
              );
            })
          ) : (
            <div className="text-secondary text-sm">No matching time zones.</div>
          )}
        </div>
      </div>
    </ActionSheet>
  );
}

export { TimeZoneSheet };
