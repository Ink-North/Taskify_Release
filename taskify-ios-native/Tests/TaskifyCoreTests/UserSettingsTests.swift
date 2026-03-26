import Foundation
import Testing
@testable import TaskifyCore

@Suite("UserSettings")
struct UserSettingsTests {

    @Test("resolves startup board using Taskify weekday mapping")
    func startupBoardResolution() {
        let settings = UserSettings(
            startBoardByDay: [
                0: "sunday-board",
                1: "monday-board",
                6: "saturday-board",
            ]
        )

        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!

        let saturday = calendar.date(from: DateComponents(year: 2026, month: 3, day: 28))!
        let sunday = calendar.date(from: DateComponents(year: 2026, month: 3, day: 29))!
        let monday = calendar.date(from: DateComponents(year: 2026, month: 3, day: 30))!

        #expect(settings.startBoardId(for: saturday, calendar: calendar) == "saturday-board")
        #expect(settings.startBoardId(for: sunday, calendar: calendar) == "sunday-board")
        #expect(settings.startBoardId(for: monday, calendar: calendar) == "monday-board")
    }

    @Test("ignores blank startup board ids")
    func blankStartupBoardIgnored() {
        let settings = UserSettings(startBoardByDay: [0: "  "])
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let sunday = calendar.date(from: DateComponents(year: 2026, month: 3, day: 29))!
        #expect(settings.startBoardId(for: sunday, calendar: calendar) == nil)
    }
}
