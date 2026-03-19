import Foundation
import SwiftData
import TaskifyCore

@MainActor
final class AppViewModel: ObservableObject {
    @Published var selectedBoardId: String?
    @Published var showingAddBoard = false
    @Published var newBoardName = ""
    @Published var newBoardKind: String = "week"

    func bootstrapIfNeeded(context: ModelContext) throws {
        let boardCount = try context.fetchCount(FetchDescriptor<TaskifyBoard>())
        guard boardCount == 0 else {
            if selectedBoardId == nil {
                let first = try context.fetch(FetchDescriptor<TaskifyBoard>()).first
                selectedBoardId = first?.id
            }
            return
        }

        let weekBoard = TaskifyBoard(id: UUID().uuidString, name: "This Week", kind: "week")
        let listsBoard = TaskifyBoard(id: UUID().uuidString, name: "Inbox", kind: "lists")
        listsBoard.columnsJSON = "[{\"id\":\"items\",\"name\":\"Items\"}]"

        let sampleTasks: [TaskifyTask] = [
            {
                let t = TaskifyTask(id: UUID().uuidString, boardId: weekBoard.id, title: "Ship iOS shell", completed: false)
                t.boardName = weekBoard.name
                t.priority = 1
                t.dueISO = ISO8601DateFormatter().string(from: Date())
                return t
            }(),
            {
                let t = TaskifyTask(id: UUID().uuidString, boardId: weekBoard.id, title: "Verify crypto interop", completed: false)
                t.boardName = weekBoard.name
                t.priority = 2
                return t
            }(),
            {
                let t = TaskifyTask(id: UUID().uuidString, boardId: listsBoard.id, title: "Refine board list UI", completed: false)
                t.boardName = listsBoard.name
                t.column = "items"
                return t
            }(),
        ]

        context.insert(weekBoard)
        context.insert(listsBoard)
        sampleTasks.forEach { context.insert($0) }
        try context.save()
        selectedBoardId = weekBoard.id
    }

    func createBoard(context: ModelContext) throws {
        let name = newBoardName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return }
        let board = TaskifyBoard(id: UUID().uuidString, name: name, kind: newBoardKind)
        if newBoardKind == "lists" {
            board.columnsJSON = "[{\"id\":\"items\",\"name\":\"Items\"}]"
        }
        context.insert(board)
        try context.save()
        selectedBoardId = board.id
        newBoardName = ""
        newBoardKind = "week"
        showingAddBoard = false
    }
}
