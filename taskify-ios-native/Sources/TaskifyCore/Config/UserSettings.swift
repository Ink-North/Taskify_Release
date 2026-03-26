/// UserSettings.swift
/// App settings model matching the PWA's Settings type for cross-compatibility.
/// Persisted to UserDefaults (equivalent to PWA's localStorage).

import Foundation

// MARK: - Accent color choice

public enum AccentChoice: String, Codable, CaseIterable, Identifiable {
    case blue
    case green

    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .blue: return "iMessage blue"
        case .green: return "Mint green"
        }
    }

    public var fill: String {
        switch self {
        case .blue: return "#0a84ff"
        case .green: return "#34c759"
        }
    }
}

// MARK: - Appearance mode

public enum AppearanceMode: String, Codable, CaseIterable, Identifiable {
    case system
    case light
    case dark

    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .system: return "System"
        case .light: return "Light"
        case .dark: return "Dark"
        }
    }
}

// MARK: - New task position

public enum NewTaskPosition: String, Codable, CaseIterable, Identifiable {
    case top
    case bottom

    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .top: return "Top"
        case .bottom: return "Bottom"
        }
    }
}

// MARK: - UserSettings (matches PWA settingsTypes.ts for cross-compat fields)

public struct UserSettings: Codable, Equatable {

    // Display
    public var accent: AccentChoice
    public var appearance: AppearanceMode
    public var weekStart: Int                        // 0=Sun, 1=Mon, 6=Sat (matches PWA Weekday)
    public var newTaskPosition: NewTaskPosition
    public var baseFontSize: Double?                 // nil = system default

    // Feature toggles
    public var streaksEnabled: Bool
    public var completedTab: Bool
    public var hideCompletedSubtasks: Bool
    public var showFullWeekRecurring: Bool

    // Backup
    public var nostrBackupEnabled: Bool
    public var cloudBackupsEnabled: Bool

    // Per-weekday start board (PWA: startBoardByDay)
    public var startBoardByDay: [Int: String]        // Weekday → boardId

    public init(
        accent: AccentChoice = .blue,
        appearance: AppearanceMode = .system,
        weekStart: Int = 0,
        newTaskPosition: NewTaskPosition = .top,
        baseFontSize: Double? = nil,
        streaksEnabled: Bool = true,
        completedTab: Bool = true,
        hideCompletedSubtasks: Bool = false,
        showFullWeekRecurring: Bool = false,
        nostrBackupEnabled: Bool = false,
        cloudBackupsEnabled: Bool = false,
        startBoardByDay: [Int: String] = [:]
    ) {
        self.accent = accent
        self.appearance = appearance
        self.weekStart = weekStart
        self.newTaskPosition = newTaskPosition
        self.baseFontSize = baseFontSize
        self.streaksEnabled = streaksEnabled
        self.completedTab = completedTab
        self.hideCompletedSubtasks = hideCompletedSubtasks
        self.showFullWeekRecurring = showFullWeekRecurring
        self.nostrBackupEnabled = nostrBackupEnabled
        self.cloudBackupsEnabled = cloudBackupsEnabled
        self.startBoardByDay = startBoardByDay
    }

    /// Default settings matching PWA defaults.
    public static let defaults = UserSettings()

    /// Resolves the configured startup board for the given date using the
    /// Taskify weekday mapping (0 = Sunday ... 6 = Saturday).
    public func startBoardId(for date: Date = Date(), calendar: Calendar = .current) -> String? {
        let weekday = Self.taskifyWeekday(for: date, calendar: calendar)
        guard let boardId = startBoardByDay[weekday]?.trimmingCharacters(in: .whitespacesAndNewlines),
              !boardId.isEmpty else {
            return nil
        }
        return boardId
    }

    public static func taskifyWeekday(for date: Date, calendar: Calendar = .current) -> Int {
        let swiftWeekday = calendar.component(.weekday, from: date)
        return (swiftWeekday + 6) % 7
    }
}

// MARK: - Persistence

public enum UserSettingsStore {
    private static let key = "ai.taskify.settings"

    public static func load() -> UserSettings {
        guard let data = UserDefaults.standard.data(forKey: key),
              let settings = try? JSONDecoder().decode(UserSettings.self, from: data) else {
            return .defaults
        }
        return settings
    }

    public static func save(_ settings: UserSettings) {
        guard let data = try? JSONEncoder().encode(settings) else { return }
        UserDefaults.standard.set(data, forKey: key)
    }
}

// MARK: - Observable Settings Manager

@MainActor
public final class SettingsManager: ObservableObject {
    @Published public var settings: UserSettings {
        didSet {
            savePending = true
            scheduleSave()
        }
    }

    private var savePending = false
    private var saveTask: Task<Void, Never>?

    public init() {
        self.settings = UserSettingsStore.load()
    }

    /// Debounced save (500ms, matching PWA behavior).
    private func scheduleSave() {
        saveTask?.cancel()
        saveTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 500_000_000)
            guard !Task.isCancelled, let self, self.savePending else { return }
            UserSettingsStore.save(self.settings)
            self.savePending = false
        }
    }

    /// Save immediately (for sign-out, background, etc.).
    public func saveNow() {
        saveTask?.cancel()
        UserSettingsStore.save(settings)
        savePending = false
    }
}
