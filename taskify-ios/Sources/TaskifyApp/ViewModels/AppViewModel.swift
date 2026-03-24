import Foundation
import SwiftData
import TaskifyCore

@MainActor
final class AppViewModel: ObservableObject {
    @Published var selectedBoardId: String?
    @Published var showingAddBoard = false
    @Published var newBoardName = ""
    @Published var newBoardKind: String = "week"
    @Published var showingTaskComposer = false
    @Published var taskDraft = TaskDraft()
    @Published var editingTaskId: String?

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
        taskDraft = TaskDraft(boardId: boardId)
        editingTaskId = nil
        showingTaskComposer = true
    }

    func openEditor(for task: TaskifyTask) {
        taskDraft = TaskDraft(
            boardId: task.boardId,
            title: task.title,
            note: task.note ?? "",
            dueDate: task.dueISO.flatMap { ISO8601DateFormatter().date(from: $0) },
            priority: task.priority ?? 0,
            columnId: task.column
        )
        editingTaskId = task.id
        showingTaskComposer = true
    }

    func saveTask(context: ModelContext, boards: [TaskifyBoard]) throws {
        let title = taskDraft.title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty else { return }
        let boardId = taskDraft.boardId ?? boards.first?.id
        guard let boardId else { return }
        let board = boards.first(where: { $0.id == boardId })

        if let editingTaskId,
           let task = try context.fetch(FetchDescriptor<TaskifyTask>(predicate: #Predicate { $0.id == editingTaskId })).first {
            task.title = title
            task.note = taskDraft.note.isEmpty ? nil : taskDraft.note
            task.boardId = boardId
            task.boardName = board?.name
            task.priority = taskDraft.priority == 0 ? nil : taskDraft.priority
            task.column = taskDraft.columnId
            task.updatedAt = ISO8601DateFormatter().string(from: Date())
            task.dueISO = taskDraft.dueDate.map { ISO8601DateFormatter().string(from: $0) }
        } else {
            let task = TaskifyTask(id: UUID().uuidString, boardId: boardId, title: title, completed: false)
            task.note = taskDraft.note.isEmpty ? nil : taskDraft.note
            task.boardName = board?.name
            task.priority = taskDraft.priority == 0 ? nil : taskDraft.priority
            task.column = taskDraft.columnId
            if let dueDate = taskDraft.dueDate {
                task.dueISO = ISO8601DateFormatter().string(from: dueDate)
            }
            context.insert(task)
        }
        try context.save()
        showingTaskComposer = false
        editingTaskId = nil
        taskDraft = TaskDraft()
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

struct TaskDraft {
    var boardId: String? = nil
    var title: String = ""
    var note: String = ""
    var dueDate: Date? = nil
    var priority: Int = 0
    var columnId: String? = nil
}
