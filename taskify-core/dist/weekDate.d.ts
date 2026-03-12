export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export declare function startOfWeekLocal(date: Date, weekStart: Weekday): Date;
export declare function isoForWeekdayLocal(target: Weekday, options?: {
    base?: Date;
    weekStart?: Weekday;
}): string;
