import Foundation

public enum ListBoardKind: Equatable {
    case lists
    case compound
    case other
}

public struct ListBoardDefinition {
    public var id: String
    public var name: String
    public var kind: ListBoardKind
    public var columns: [BoardColumn]
    public var children: [String]
    public var hideChildBoardNames: Bool

    public init(
        id: String,
        name: String,
        kind: ListBoardKind,
        columns: [BoardColumn],
        children: [String] = [],
        hideChildBoardNames: Bool = false
    ) {
        self.id = id
        self.name = name
        self.kind = kind
        self.columns = columns
        self.children = children
        self.hideChildBoardNames = hideChildBoardNames
    }
}

public struct ListColumnSource: Equatable {
    public var boardId: String
    public var columnId: String
    public var boardName: String
}

public struct CompoundIndexGroup {
    public var key: String
    public var boardId: String
    public var boardName: String
    public var columns: [BoardColumn]
}

public struct ListColumnTaskItem: Equatable, Identifiable {
    public let id: String
    public let boardId: String
    public let columnId: String
    public let title: String
    public let completed: Bool

    public init(id: String, boardId: String, columnId: String, title: String, completed: Bool) {
        self.id = id
        self.boardId = boardId
        self.columnId = columnId
        self.title = title
        self.completed = completed
    }
}

@MainActor
public final class ListColumnsViewModel: ObservableObject {
    @Published public private(set) var listColumns: [BoardColumn] = []
    @Published public private(set) var listColumnSources: [String: ListColumnSource] = [:]
    @Published public private(set) var compoundIndexGroups: [CompoundIndexGroup] = []
    @Published public private(set) var itemsByColumn: [String: [ListColumnTaskItem]] = [:]

    private var currentBoard: ListBoardDefinition?

    public init() {}

    public func configure(currentBoard: ListBoardDefinition?, boards: [ListBoardDefinition]) {
        self.currentBoard = currentBoard
        listColumns = []
        listColumnSources = [:]
        compoundIndexGroups = []
        itemsByColumn = [:]

        guard let currentBoard else { return }

        switch currentBoard.kind {
        case .lists:
            listColumns = currentBoard.columns
            for col in currentBoard.columns {
                listColumnSources[col.id] = .init(boardId: currentBoard.id, columnId: col.id, boardName: currentBoard.name)
            }

        case .compound:
            var columns: [BoardColumn] = []
            var groups: [CompoundIndexGroup] = []
            var sources: [String: ListColumnSource] = [:]

            for childId in currentBoard.children {
                guard let child = boards.first(where: { $0.id == childId && $0.kind == .lists }) else { continue }

                var group = CompoundIndexGroup(key: child.id, boardId: child.id, boardName: child.name, columns: [])
                for col in child.columns {
                    let displayName = currentBoard.hideChildBoardNames ? col.name : "\(child.name) • \(col.name)"
                    let canonical = compoundColumnKey(child.id, col.id)
                    columns.append(.init(id: canonical, name: displayName))
                    sources[canonical] = .init(boardId: child.id, columnId: col.id, boardName: child.name)
                    group.columns.append(.init(id: canonical, name: col.name))
                }
                groups.append(group)
            }

            listColumns = columns
            listColumnSources = sources
            compoundIndexGroups = groups

        case .other:
            break
        }
    }

    public func setTasks(_ tasks: [ListColumnTaskItem]) {
        var next: [String: [ListColumnTaskItem]] = [:]
        guard let currentBoard else {
            itemsByColumn = next
            return
        }

        switch currentBoard.kind {
        case .lists:
            for task in tasks where listColumnSources[task.columnId] != nil {
                next[task.columnId, default: []].append(task)
            }

        case .compound:
            for task in tasks {
                let key = compoundColumnKey(task.boardId, task.columnId)
                guard listColumnSources[key] != nil else { continue }
                next[key, default: []].append(task)
            }

        case .other:
            break
        }

        itemsByColumn = next
    }

    @discardableResult
    public func addList(name: String) -> String? {
        guard currentBoard?.kind == .lists else { return nil }
        let newId = "col-\(listColumns.count + 1)"
        listColumns.append(.init(id: newId, name: name))
        if let board = currentBoard {
            listColumnSources[newId] = .init(boardId: board.id, columnId: newId, boardName: board.name)
        }
        return newId
    }

    public func addInlineTask(columnId: String, title: String) {
        guard listColumnSources[columnId] != nil else { return }
        let item = ListColumnTaskItem(id: UUID().uuidString, boardId: listColumnSources[columnId]!.boardId, columnId: listColumnSources[columnId]!.columnId, title: title, completed: false)
        itemsByColumn[columnId, default: []].insert(item, at: 0)
    }
}

private func compoundColumnKey(_ boardId: String, _ columnId: String) -> String {
    "\(boardId):\(columnId)"
}
