# Cross-Compatibility Spec: Events (CLI ↔ PWA)

## Goal
Add Taskify CLI event workflows that round-trip safely with existing Taskify PWA event models.

## Event shape contract
CLI must emit/parse the same `CalendarEvent` variants as PWA:
- `kind: "date"` with `startDate`, optional `endDate` (all-day + multi-day)
- `kind: "time"` with `startISO`, optional `endISO`, optional `startTzid`/`endTzid`

## Guardrails
- Date format: `YYYY-MM-DD`
- Time format: `HH:mm`
- Reject invalid mixed ranges (`endDate` + timed fields)
- Preserve unknown fields during read/update publish paths

## CLI command targets
- `taskify event list`
- `taskify event add`
- `taskify event show`
- `taskify event update`
- `taskify event delete`

## Test-first requirements
- date event draft tests
- timed event draft tests (with tzid)
- multi-day all-day tests
- invalid mixed-input rejection tests
