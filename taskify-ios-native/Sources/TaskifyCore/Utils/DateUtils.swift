import Foundation

// MARK: - Date Utilities

public struct DateUtils {
    /// ISO date pattern (YYYY-MM-DD)
    public static let ISO_DATE_PATTERN = "^\\d{4}-\\d{2}-\\d{2}$"

    /// Milliseconds per day
    public static let MS_PER_DAY = 86400000

    /// Parse a date string in ISO format
    public static func parseISODate(_ string: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withYear, .withMonth, .withDay, .withFractionalSeconds]
        return formatter.date(from: string)
    }

    /// Format a date to ISO date string (YYYY-MM-DD)
    public static func formatISODate(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withYear, .withMonth, .withDay]
        return formatter.string(from: date)
    }

    /// Format a date to ISO date time string with timezone
    public static func formatISODateTime(_ date: Date, timeZone: TimeZone? = nil) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withYear, .withMonth, .withDay, .withTime, .withTimeZone]
        if let tz = timeZone {
            formatter.timeZone = tz
        }
        return formatter.string(from: date)
    }

    /// Parse a date time string
    public static func parseISODateTime(_ string: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withYear, .withMonth, .withDay, .withTime, .withTimeZone]
        return formatter.date(from: string)
    }

    /// Get date part only (YYYY-MM-DD)
    public static func isoDatePart(_ isoDateTime: String, timeZone: TimeZone? = nil) -> String {
        guard let date = parseISODateTime(isoDateTime) else {
            return ""
        }
        return formatISODate(date)
    }

    /// Get time part only (HH:MM:SS)
    public static func isoTimePart(_ isoDateTime: String, timeZone: TimeZone? = nil) -> String {
        guard let date = parseISODateTime(isoDateTime) else {
            return ""
        }

        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss"
        if let tz = timeZone {
            formatter.timeZone = tz
        }
        return formatter.string(from: date)
    }

    /// Start of day at midnight UTC
    public static func startOfDay(_ date: Date) -> Date {
        return Calendar(identifier: .gregorian).startOfDay(for: date)
    }

    /// Parse date key (YYYY-MM-DD) to date components
    public static func parseDateKey(_ key: String) -> (year: Int, month: Int, day: Int)? {
        let pattern = "^\\d{4}-\\d{2}-\\d{2}$"
        guard Regex(pattern).matches(key) else {
            return nil
        }

        let components = key.split(separator: "-").map { String($0) }
        guard components.count == 3,
              let year = Int(components[0]),
              let month = Int(components[1]),
              let day = Int(components[2]) else {
            return nil
        }

        return (year, month, day)
    }

    /// Format date parts to date key (YYYY-MM-DD)
    public static func formatDateKeyFromParts(year: Int, month: Int, day: Int) -> String {
        return String(format: "%04d-%02d-%02d", year, month, day)
    }

    /// Create ISO datetime from date and time parts
    public static func isoFromDateTime(_ dateKey: String, time: String? = nil, timeZone: TimeZone? = nil) -> String {
        guard let dateParts = parseDateKey(dateKey),
              let date = DateComponents(year: dateParts.year,
                                        month: dateParts.month,
                                        day: dateParts.day).date else {
            return dateKey
        }

        if let time = time {
            let timeFormatter = DateFormatter()
            timeFormatter.dateFormat = "HH:mm:ss"
            if let timeDate = timeFormatter.date(from: time) {
                let combined = Calendar.current.date(byAdding: .second, value: 0, to: date.addingTimeInterval(timeDate.timeIntervalSince1970))
                return formatISODateTime(combined, timeZone: timeZone)
            }
        }

        return formatISODateTime(date, timeZone: timeZone)
    }

    /// Normalize timezone to a valid IANA timezone string
    public static func normalizeTimeZone(_ tz: String?) -> String? {
        guard let tz = tz, !tz.isEmpty else {
            return nil
        }

        // Try to create a TimeZone
        let identifier = tz.lowercased()
        if TimeZone(identifier: identifier) != nil {
            return identifier
        }

        return nil
    }

    /// Get current timezone
    public static func currentTimeZone() -> TimeZone {
        return .current
    }

    /// Get current date as ISO string
    public static func currentISODate() -> String {
        return formatISODate(Date())
    }

    /// Get current date time as ISO string
    public static func currentISODateTime() -> String {
        return formatISODateTime(Date())
    }

    /// Get current date time with optional timezone as ISO string
    public static func currentISODateTime(timeZone: TimeZone? = nil) -> String {
        return formatISODateTime(Date(), timeZone: timeZone)
    }

    /// Convert milliseconds since epoch to Date
    public static func dateFromMilliseconds(_ ms: Int) -> Date {
        return Date(timeIntervalSince1970: TimeInterval(ms) / 1000.0)
    }

    /// Convert Date to milliseconds since epoch
    public static func millisecondsFromDate(_ date: Date) -> Int {
        return Int(date.timeIntervalSince1970 * 1000.0)
    }

    /// Add days to a date
    public static func addDays(_ date: Date, days: Int) -> Date {
        return Calendar.current.date(byAdding: .day, value: days, to: date) ?? date
    }

    /// Add hours to a date
    public static func addHours(_ date: Date, hours: Int) -> Date {
        return Calendar.current.date(byAdding: .hour, value: hours, to: date) ?? date
    }

    /// Add weeks to a date
    public static func addWeeks(_ date: Date, weeks: Int) -> Date {
        return Calendar.current.date(byAdding: .weekOfYear, value: weeks, to: date) ?? date
    }

    /// Get start of week based on weekStartDay
    public static func startOfWeek(_ date: Date, weekStartDay: Int = 1) -> Date {
        let calendar = Calendar(identifier: .gregorian)
        var components = calendar.dateComponents([.yearForWeekOfYear, .weekOfYear], from: date)
        guard let weekDate = calendar.date(from: components) else {
            return date
        }

        // Adjust to target week start day
        var startComponents = calendar.dateComponents([.yearForWeekOfYear, .weekOfYear], from: weekDate)
        startComponents.weekday = weekStartDay
        startComponents.weekOfMonth = nil // Reset to first week of the year

        return calendar.date(from: startComponents) ?? weekDate
    }

    /// Get end of week
    public static func endOfWeek(_ date: Date, weekStartDay: Int = 1) -> Date {
        return addDays(startOfWeek(date, weekStartDay: weekStartDay), days: 6)
    }

    /// Check if a string matches ISO date pattern
    public static func isISODate(_ string: String) -> Bool {
        return Regex(isoDatePattern).matches(string)
    }

    /// Check if a string matches ISO datetime pattern
    public static func isISODateTime(_ string: String) -> Bool {
        return Regex(ISO8601DateFormatter().pattern).matches(string)
    }
}