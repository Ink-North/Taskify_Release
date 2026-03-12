export type BuiltinReminderPreset = "0h" | "5m" | "15m" | "30m" | "1h" | "1d" | "1w" | "0d";
export type CustomReminderPreset = `custom-${number}`;
export type ReminderPreset = BuiltinReminderPreset | CustomReminderPreset;
export type ReminderPresetMode = "timed" | "date";
export declare const DEFAULT_DATE_REMINDER_TIME = "09:00";
export declare const TIMED_REMINDER_PRESETS: ReadonlyArray<{
    id: BuiltinReminderPreset;
    label: string;
    badge: string;
    minutes: number;
}>;
export declare const DATE_REMINDER_PRESETS: ReadonlyArray<{
    id: BuiltinReminderPreset;
    label: string;
    badge: string;
    minutes: number;
}>;
export declare const BUILTIN_REMINDER_PRESETS: ReadonlyArray<{
    id: BuiltinReminderPreset;
    label: string;
    badge: string;
    minutes: number;
}>;
export declare const BUILTIN_REMINDER_IDS: Set<BuiltinReminderPreset>;
export declare const BUILTIN_REMINDER_MINUTES: Map<BuiltinReminderPreset, number>;
export declare const MS_PER_DAY = 86400000;
export declare const CUSTOM_REMINDER_PATTERN: RegExp;
export declare const MIN_CUSTOM_REMINDER_MINUTES = -99999999;
export declare const MAX_CUSTOM_REMINDER_MINUTES = 99999999;
export declare function clampCustomReminderMinutes(value: number): number;
export declare function normalizeReminderTime(value: unknown): string | undefined;
export declare function minutesToReminderId(minutes: number): ReminderPreset;
export declare function reminderPresetIdForMode(minutes: number, mode: ReminderPresetMode): ReminderPreset;
export declare function reminderPresetToMinutes(id: ReminderPreset): number;
export declare function formatReminderLabel(minutes: number): {
    label: string;
    badge: string;
};
export type ReminderOption = {
    id: ReminderPreset;
    label: string;
    badge: string;
    minutes: number;
    builtin: boolean;
};
export declare function buildReminderOptions(extraPresetIds?: ReminderPreset[], mode?: ReminderPresetMode): ReminderOption[];
export declare function sanitizeReminderList(value: unknown): ReminderPreset[] | undefined;
