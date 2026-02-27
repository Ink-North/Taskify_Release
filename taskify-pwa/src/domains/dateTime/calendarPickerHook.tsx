import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { MONTH_NAMES, WD_SHORT } from "../appTypes";
import {
  calendarAnchorFrom,
  formatDateKeyLocal,
  getWheelNearestIndex,
  scrollWheelColumnToIndex,
  scheduleWheelSnap,
} from "./dateUtils";

const MONTH_PICKER_YEAR_WINDOW = 1000;

export function useCalendarPicker(baseDate?: string) {
  const [calendarAnchor, setCalendarAnchor] = useState(() => calendarAnchorFrom(baseDate));
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const [monthPickerMonth, setMonthPickerMonth] = useState(calendarAnchor.getMonth());
  const [monthPickerYear, setMonthPickerYear] = useState(() => calendarAnchor.getFullYear());
  const monthPickerMonthColumnRef = useRef<HTMLDivElement | null>(null);
  const monthPickerYearColumnRef = useRef<HTMLDivElement | null>(null);
  const monthPickerMonthScrollFrame = useRef<number | null>(null);
  const monthPickerYearScrollFrame = useRef<number | null>(null);
  const monthPickerMonthSnapTimeout = useRef<number | null>(null);
  const monthPickerYearSnapTimeout = useRef<number | null>(null);
  const monthPickerMonthValueRef = useRef(monthPickerMonth);
  const monthPickerYearValueRef = useRef(monthPickerYear);

  const monthPickerYears = useMemo(() => {
    const anchorYear = calendarAnchor.getFullYear();
    const start = anchorYear - MONTH_PICKER_YEAR_WINDOW;
    const end = anchorYear + MONTH_PICKER_YEAR_WINDOW;
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  }, [calendarAnchor]);

  const calendarMonthLabel = useMemo(
    () => calendarAnchor.toLocaleDateString([], { month: "long", year: "numeric" }),
    [calendarAnchor],
  );

  const calendarCells = useMemo(() => {
    const year = calendarAnchor.getFullYear();
    const month = calendarAnchor.getMonth();
    const firstWeekday = new Date(year, month, 1).getDay();
    const totalDays = new Date(year, month + 1, 0).getDate();
    const totalCells = Math.ceil((firstWeekday + totalDays) / 7) * 7;
    const cells: (number | null)[] = [];
    for (let i = 0; i < totalCells; i += 1) {
      const day = i - firstWeekday + 1;
      cells.push(day > 0 && day <= totalDays ? day : null);
    }
    return { cells, year, month };
  }, [calendarAnchor]);

  const todayDate = useMemo(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), today.getDate());
  }, []);

  useEffect(() => {
    setCalendarAnchor(calendarAnchorFrom(baseDate));
  }, [baseDate]);

  useEffect(() => {
    setMonthPickerMonth(calendarAnchor.getMonth());
    setMonthPickerYear(calendarAnchor.getFullYear());
  }, [calendarAnchor]);

  useEffect(() => {
    monthPickerMonthValueRef.current = monthPickerMonth;
  }, [monthPickerMonth]);

  useEffect(() => {
    monthPickerYearValueRef.current = monthPickerYear;
  }, [monthPickerYear]);

  useEffect(() => {
    if (!showMonthPicker) return;
    scrollWheelColumnToIndex(monthPickerMonthColumnRef.current, monthPickerMonth);
    const yearIndex = monthPickerYears.indexOf(monthPickerYear);
    if (yearIndex >= 0) {
      scrollWheelColumnToIndex(monthPickerYearColumnRef.current, yearIndex);
    }
  }, [monthPickerMonth, monthPickerYear, monthPickerYears, showMonthPicker]);

  const moveCalendarMonth = useCallback((delta: number) => {
    setCalendarAnchor((prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
  }, []);

  const applyMonthPickerSelection = useCallback(() => {
    const safeYear = Number.isFinite(monthPickerYear) ? monthPickerYear : calendarAnchor.getFullYear();
    const safeMonth = Math.min(11, Math.max(0, monthPickerMonth));
    setCalendarAnchor(new Date(safeYear, safeMonth, 1));
    setShowMonthPicker(false);
  }, [calendarAnchor, monthPickerMonth, monthPickerYear]);

  const handleMonthLabelClick = useCallback(() => {
    if (!showMonthPicker) {
      setMonthPickerMonth(calendarAnchor.getMonth());
      setMonthPickerYear(calendarAnchor.getFullYear());
      setShowMonthPicker(true);
    } else {
      applyMonthPickerSelection();
    }
  }, [applyMonthPickerSelection, calendarAnchor, showMonthPicker]);

  const handleMonthPickerMonthScroll = useCallback(() => {
    const column = monthPickerMonthColumnRef.current;
    if (!column) return;
    if (monthPickerMonthScrollFrame.current != null) {
      cancelAnimationFrame(monthPickerMonthScrollFrame.current);
    }
    monthPickerMonthScrollFrame.current = requestAnimationFrame(() => {
      const clampedIndex = getWheelNearestIndex(column, MONTH_NAMES.length);
      if (clampedIndex == null) return;
      if (monthPickerMonthValueRef.current !== clampedIndex) {
        setMonthPickerMonth(clampedIndex);
      }
      scheduleWheelSnap(monthPickerMonthColumnRef, monthPickerMonthSnapTimeout, clampedIndex);
    });
  }, []);

  const handleMonthPickerYearScroll = useCallback(() => {
    const column = monthPickerYearColumnRef.current;
    if (!column) return;
    if (monthPickerYearScrollFrame.current != null) {
      cancelAnimationFrame(monthPickerYearScrollFrame.current);
    }
    monthPickerYearScrollFrame.current = requestAnimationFrame(() => {
      const clampedIndex = getWheelNearestIndex(column, monthPickerYears.length);
      if (clampedIndex == null) return;
      const nextYear = monthPickerYears[clampedIndex];
      if (nextYear != null && monthPickerYearValueRef.current !== nextYear) {
        setMonthPickerYear(nextYear);
      }
      if (nextYear != null) {
        scheduleWheelSnap(monthPickerYearColumnRef, monthPickerYearSnapTimeout, clampedIndex);
      }
    });
  }, [monthPickerYears]);

  return {
    calendarAnchor,
    calendarMonthLabel,
    calendarCells,
    todayDate,
    showMonthPicker,
    moveCalendarMonth,
    handleMonthLabelClick,
    monthPickerYears,
    monthPickerMonth,
    monthPickerYear,
    monthPickerMonthColumnRef,
    monthPickerYearColumnRef,
    handleMonthPickerMonthScroll,
    handleMonthPickerYearScroll,
  };
}

export function DatePickerCalendar({
  baseDate,
  selectedDate,
  onSelectDate,
}: {
  baseDate?: string;
  selectedDate?: string;
  onSelectDate: (iso: string) => void;
}) {
  const {
    calendarMonthLabel,
    calendarCells,
    todayDate,
    showMonthPicker,
    moveCalendarMonth,
    handleMonthLabelClick,
    monthPickerYears,
    monthPickerMonth,
    monthPickerYear,
    monthPickerMonthColumnRef,
    monthPickerYearColumnRef,
    handleMonthPickerMonthScroll,
    handleMonthPickerYearScroll,
  } = useCalendarPicker(baseDate);

  const selectedDateObj = useMemo(() => {
    if (!selectedDate) return null;
    const parsed = new Date(`${selectedDate}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }, [selectedDate]);

  function handleSelectCalendarDay(day: number | null) {
    if (!day) return;
    const next = new Date(calendarCells.year, calendarCells.month, day);
    if (Number.isNaN(next.getTime())) return;
    onSelectDate(formatDateKeyLocal(next));
  }

  return (
    <div className="edit-calendar">
      <div className="edit-calendar__header">
        <button
          type="button"
          className="ghost-button button-sm pressable"
          onClick={() => moveCalendarMonth(-1)}
          aria-label="Previous month"
        >
          ‹
        </button>
        <button type="button" className="edit-calendar__month" onClick={handleMonthLabelClick}>
          {calendarMonthLabel}
        </button>
        <button
          type="button"
          className="ghost-button button-sm pressable"
          onClick={() => moveCalendarMonth(1)}
          aria-label="Next month"
        >
          ›
        </button>
      </div>
      {showMonthPicker && (
        <div className="edit-month-picker">
          <div
            className="edit-month-picker__column"
            ref={monthPickerMonthColumnRef}
            onScroll={handleMonthPickerMonthScroll}
            role="listbox"
            aria-label="Select month"
          >
            {MONTH_NAMES.map((name, idx) => (
              <div
                key={name}
                className={`edit-month-picker__option ${monthPickerMonth === idx ? "is-active" : ""}`}
                data-picker-index={idx}
                role="option"
                aria-selected={monthPickerMonth === idx}
              >
                {name.slice(0, 3)}
              </div>
            ))}
          </div>
          <div
            className="edit-month-picker__column"
            ref={monthPickerYearColumnRef}
            onScroll={handleMonthPickerYearScroll}
            role="listbox"
            aria-label="Select year"
          >
            {monthPickerYears.map((year, idx) => (
              <div
                key={year}
                className={`edit-month-picker__option ${monthPickerYear === year ? "is-active" : ""}`}
                data-picker-index={idx}
                role="option"
                aria-selected={monthPickerYear === year}
              >
                {year}
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="edit-calendar__weekdays">
        {WD_SHORT.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      <div className="edit-calendar__grid">
        {calendarCells.cells.map((cell, idx) => {
          if (!cell) {
            return <span key={`empty-${idx}`} className="edit-calendar__day edit-calendar__day--muted" />;
          }
          const isSelected =
            !!selectedDateObj &&
            selectedDateObj.getFullYear() === calendarCells.year &&
            selectedDateObj.getMonth() === calendarCells.month &&
            selectedDateObj.getDate() === cell;
          const currentViewDate = new Date(calendarCells.year, calendarCells.month, cell);
          const isToday =
            todayDate.getFullYear() === currentViewDate.getFullYear() &&
            todayDate.getMonth() === currentViewDate.getMonth() &&
            todayDate.getDate() === currentViewDate.getDate();
          const dayCls = [
            "edit-calendar__day",
            isSelected ? "edit-calendar__day--selected" : "",
            !isSelected && isToday ? "edit-calendar__day--today" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <button
              key={`day-${idx}-${cell}`}
              type="button"
              className={dayCls}
              onClick={() => handleSelectCalendarDay(cell)}
            >
              {cell}
            </button>
          );
        })}
      </div>
    </div>
  );
}
