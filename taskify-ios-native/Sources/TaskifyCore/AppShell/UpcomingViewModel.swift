import Foundation

public struct UpcomingDateGroup: Identifiable {
    public var id: String { label }
    public let label: String
    public let date: Date?
    public let tasks: [BoardTaskItem]

    public init(label: String, date: Date?, tasks: [BoardTaskItem]) {
        self.label = label
        self.date = date
        self.tasks = tasks
    }
}

@MainActor
public final class UpcomingViewModel: ObservableObject {
    @Published public private(set) var groups: [UpcomingDateGroup] = []
    @Published public private(set) var overdueTasks: [BoardTaskItem] = []
    @Published public private(set) var noDueDateTasks: [BoardTaskItem] = []

    private var allTasks: [BoardTaskItem] = []

    public init() {}

    public func setTasks(_ tasks: [BoardTaskItem]) {
        allTasks = tasks
        recompute()
    }

    public func toggleComplete(taskId: String) {
        guard let idx = allTasks.firstIndex(where: { $0.id == taskId }) else { return }
        let old = allTasks[idx]
        allTasks[idx] = BoardTaskItem(
            id: old.id, title: old.title, completed: !old.completed,
            dueISO: old.dueISO, columnId: old.columnId,
            note: old.note, priority: old.priority,
            dueDateEnabled: old.dueDateEnabled, dueTimeEnabled: old.dueTimeEnabled,
            dueTimeZone: old.dueTimeZone, subtasksJSON: old.subtasksJSON,
            recurrenceJSON: old.recurrenceJSON, boardId: old.boardId,
            boardName: old.boardName, order: old.order
        )
        recompute()
    }

    private func recompute() {
        let cal = Calendar.current
        let now = Date()
        let startOfToday = cal.startOfDay(for: now)

        let openTasks = allTasks.filter { !$0.completed && !($0.dueISO?.isEmpty ?? true) }
        let noDate = allTasks.filter { !$0.completed && ($0.dueISO == nil || ($0.dueISO?.isEmpty ?? true)) }

        var dated: [(Date, BoardTaskItem)] = []
        var overdue: [BoardTaskItem] = []

        for task in openTasks {
            guard let iso = task.dueISO, let date = parseISO(iso) else { continue }
            if date < startOfToday {
                overdue.append(task)
            } else {
                dated.append((date, task))
            }
        }

        overdueTasks = overdue.sorted { ($0.dueISO ?? "") < ($1.dueISO ?? "") }
        noDueDateTasks = noDate

        // Group by date for next 14 days
        dated.sort { $0.0 < $1.0 }

        var groupMap: [String: (Date, [BoardTaskItem])] = [:]
        let df = DateFormatter()
        df.dateFormat = "EEEE, MMM d"

        for (date, task) in dated {
            let dayStart = cal.startOfDay(for: date)
            let label: String
            if cal.isDateInToday(date) {
                label = "Today"
            } else if cal.isDateInTomorrow(date) {
                label = "Tomorrow"
            } else {
                label = df.string(from: date)
            }
            let key = ISO8601DateFormatter().string(from: dayStart)
            if groupMap[key] != nil {
                groupMap[key]?.1.append(task)
            } else {
                groupMap[key] = (dayStart, [task])
            }
        }

        groups = groupMap.sorted { $0.value.0 < $1.value.0 }.map { (_, value) in
            let (date, tasks) = value
            let label: String
            if cal.isDateInToday(date) {
                label = "Today"
            } else if cal.isDateInTomorrow(date) {
                label = "Tomorrow"
            } else {
                label = df.string(from: date)
            }
            return UpcomingDateGroup(label: label, date: date, tasks: tasks)
        }
    }

    private func parseISO(_ str: String) -> Date? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.date(from: str) ?? ISO8601DateFormatter().date(from: str)
    }
}
