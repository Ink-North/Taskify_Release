import Foundation

public struct BoardTaskItem: Equatable, Identifiable {
    public let id: String
    public let title: String
    public let completed: Bool
    public let dueISO: String?

    public init(id: String, title: String, completed: Bool, dueISO: String? = nil) {
        self.id = id
        self.title = title
        self.completed = completed
        self.dueISO = dueISO
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
