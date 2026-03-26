import Foundation

public struct BoardTaskItem: Equatable, Identifiable {
    public let id: String
    public let title: String
    public let completed: Bool
    public let dueISO: String?
    public let columnId: String?
    // Rich metadata for card display & editing
    public var note: String?
    public var priority: Int?
    public var dueDateEnabled: Bool?
    public var dueTimeEnabled: Bool?
    public var dueTimeZone: String?
    public var subtasksJSON: String?
    public var recurrenceJSON: String?
    public var assigneesJSON: String?
    public var streak: Int?
    public var boardId: String?
    public var boardName: String?
    public var order: Int?

    public init(
        id: String,
        title: String,
        completed: Bool,
        dueISO: String? = nil,
        columnId: String? = nil,
        note: String? = nil,
        priority: Int? = nil,
        dueDateEnabled: Bool? = nil,
        dueTimeEnabled: Bool? = nil,
        dueTimeZone: String? = nil,
        subtasksJSON: String? = nil,
        recurrenceJSON: String? = nil,
        assigneesJSON: String? = nil,
        streak: Int? = nil,
        boardId: String? = nil,
        boardName: String? = nil,
        order: Int? = nil
    ) {
        self.id = id
        self.title = title
        self.completed = completed
        self.dueISO = dueISO
        self.columnId = columnId
        self.note = note
        self.priority = priority
        self.dueDateEnabled = dueDateEnabled
        self.dueTimeEnabled = dueTimeEnabled
        self.dueTimeZone = dueTimeZone
        self.subtasksJSON = subtasksJSON
        self.recurrenceJSON = recurrenceJSON
        self.assigneesJSON = assigneesJSON
        self.streak = streak
        self.boardId = boardId
        self.boardName = boardName
        self.order = order
    }

    /// Create from a SwiftData TaskifyTask model.
    public static func from(_ task: TaskifyTask) -> BoardTaskItem {
        BoardTaskItem(
            id: task.id,
            title: task.title,
            completed: task.completed,
            dueISO: task.dueISO,
            columnId: task.column,
            note: task.note,
            priority: task.priority,
            dueDateEnabled: task.dueDateEnabled,
            dueTimeEnabled: task.dueTimeEnabled,
            dueTimeZone: task.dueTimeZone,
            subtasksJSON: task.subtasksJSON,
            recurrenceJSON: task.recurrenceJSON,
            assigneesJSON: task.assigneesJSON,
            streak: task.streak,
            boardId: task.boardId,
            boardName: task.boardName
        )
    }
}

public enum BoardDetailState: Equatable {
    case loading
    case empty
    case ready
    case error(String)
}

@MainActor
public final class BoardDetailViewModel: ObservableObject {
    @Published public private(set) var state: BoardDetailState = .empty
    @Published public private(set) var selectedBoardId: String?
    @Published public private(set) var visibleTasks: [BoardTaskItem] = []

    private var tasksByBoard: [String: [BoardTaskItem]] = [:]

    public init() {}

    public func setSelectedBoard(id: String?) {
        selectedBoardId = id
        guard let id else {
            visibleTasks = []
            state = .empty
            return
        }
        let tasks = tasksByBoard[id] ?? []
        visibleTasks = tasks
        state = tasks.isEmpty ? .empty : .ready
    }

    public func setTasks(for boardId: String, tasks: [BoardTaskItem]) {
        tasksByBoard[boardId] = tasks
        guard boardId == selectedBoardId else { return }
        visibleTasks = tasks
        state = tasks.isEmpty ? .empty : .ready
    }

    public func setLoading() {
        state = .loading
    }

    public func setError(_ message: String) {
        state = .error(message)
    }

    @discardableResult
    public func clearCompletedForSelectedBoard() -> Int {
        guard let id = selectedBoardId else { return 0 }
        let existing = tasksByBoard[id] ?? []
        let filtered = existing.filter { !$0.completed }
        let removed = max(0, existing.count - filtered.count)
        tasksByBoard[id] = filtered
        visibleTasks = filtered
        state = filtered.isEmpty ? .empty : .ready
        return removed
    }

    public func upcomingTasks() -> [BoardTaskItem] {
        visibleTasks.filter { !$0.completed && $0.dueISO != nil }
    }

    public var emptyMessage: String {
        "No tasks yet for this board."
    }

    // MARK: - CRUD operations

    /// Toggle completion on a task by ID.
    @discardableResult
    public func toggleComplete(taskId: String) -> Bool {
        guard let boardId = selectedBoardId,
              var tasks = tasksByBoard[boardId],
              let idx = tasks.firstIndex(where: { $0.id == taskId }) else { return false }
        let old = tasks[idx]
        tasks[idx] = BoardTaskItem(
            id: old.id, title: old.title, completed: !old.completed,
            dueISO: old.dueISO, columnId: old.columnId,
            note: old.note, priority: old.priority,
            dueDateEnabled: old.dueDateEnabled, dueTimeEnabled: old.dueTimeEnabled,
            dueTimeZone: old.dueTimeZone, subtasksJSON: old.subtasksJSON,
            recurrenceJSON: old.recurrenceJSON, assigneesJSON: old.assigneesJSON,
            streak: old.streak, boardId: old.boardId, boardName: old.boardName,
            order: old.order
        )
        tasksByBoard[boardId] = tasks
        visibleTasks = tasks
        return true
    }

    /// Add a new task to the currently selected board.
    @discardableResult
    public func addTask(_ item: BoardTaskItem) -> Bool {
        guard let boardId = selectedBoardId else { return false }
        var tasks = tasksByBoard[boardId] ?? []
        tasks.insert(item, at: 0)
        tasksByBoard[boardId] = tasks
        visibleTasks = tasks
        state = .ready
        return true
    }

    /// Update an existing task by replacing the item with matching ID.
    @discardableResult
    public func updateTask(_ item: BoardTaskItem) -> Bool {
        guard let boardId = selectedBoardId,
              var tasks = tasksByBoard[boardId],
              let idx = tasks.firstIndex(where: { $0.id == item.id }) else { return false }
        tasks[idx] = item
        tasksByBoard[boardId] = tasks
        visibleTasks = tasks
        return true
    }

    /// Delete a task by ID from the currently selected board.
    @discardableResult
    public func deleteTask(taskId: String) -> Bool {
        guard let boardId = selectedBoardId,
              var tasks = tasksByBoard[boardId] else { return false }
        tasks.removeAll { $0.id == taskId }
        tasksByBoard[boardId] = tasks
        visibleTasks = tasks
        state = tasks.isEmpty ? .empty : .ready
        return true
    }
}

@MainActor
public enum BoardDetailFixture {
    public static func empty(boardId: String) -> BoardDetailViewModel {
        let vm = BoardDetailViewModel()
        vm.setSelectedBoard(id: boardId)
        vm.setTasks(for: boardId, tasks: [])
        return vm
    }

    public static func loading(boardId: String) -> BoardDetailViewModel {
        let vm = BoardDetailViewModel()
        vm.setSelectedBoard(id: boardId)
        vm.setLoading()
        return vm
    }

    public static func error(boardId: String, message: String) -> BoardDetailViewModel {
        let vm = BoardDetailViewModel()
        vm.setSelectedBoard(id: boardId)
        vm.setError(message)
        return vm
    }

    public static func sample(boardId: String) -> BoardDetailViewModel {
        let vm = BoardDetailViewModel()
        vm.setSelectedBoard(id: boardId)
        vm.setTasks(for: boardId, tasks: [
            .init(id: "t1", title: "Draft roadmap", completed: false),
            .init(id: "t2", title: "Review PRs", completed: false),
            .init(id: "t3", title: "Ship TestFlight build", completed: true),
        ])
        return vm
    }
}
