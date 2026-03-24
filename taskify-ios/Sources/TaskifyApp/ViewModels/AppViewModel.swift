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
                let existingBoards = try context.fetch(FetchDescriptor<TaskifyBoard>())
                selectedBoardId = existingBoards.first(where: { $0.kind == "week" && !$0.archived && !$0.hidden })?.id
                    ?? existingBoards.first(where: { !$0.archived && !$0.hidden })?.id
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
                t.note = "Match the PWA feel in native SwiftUI"
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

    func openComposer(for boardId: String?) {
        // TODO: wire task composer sheet
    }

    func openEditor(for task: TaskifyTask) {
        // TODO: wire task editor sheet
    }

    func toggleTask(_ task: TaskifyTask, context: ModelContext) throws {
        task.completed.toggle()
        task.completedAt = task.completed ? ISO8601DateFormatter().string(from: Date()) : nil
        task.updatedAt = ISO8601DateFormatter().string(from: Date())
        try context.save()
    }

    func deleteTask(_ task: TaskifyTask, context: ModelContext) throws {
        task.deleted = true
        task.updatedAt = ISO8601DateFormatter().string(from: Date())
        try context.save()
    }
}
