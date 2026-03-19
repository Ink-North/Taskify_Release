import SwiftUI
import SwiftData
import TaskifyCore

private struct ColumnItem: Identifiable {
    let id: String
    let name: String
}

struct ListsBoardView: View {
    let board: TaskifyBoard
    @Query private var tasks: [TaskifyTask]

    init(board: TaskifyBoard) {
        self.board = board
        let boardId = board.id
        _tasks = Query(filter: #Predicate<TaskifyTask> { task in
            task.boardId == boardId && task.deleted == false
        }, sort: [SortDescriptor(\TaskifyTask.createdAt, order: .reverse)])
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 16) {
                ForEach(columns, id: \.id) { column in
                    VStack(alignment: .leading, spacing: 10) {
                        Text(column.name)
                            .font(.headline)
                            .padding(.horizontal, 4)
                        let columnTasks = tasksForColumn(column.id)
                        if columnTasks.isEmpty {
                            Text("No tasks")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                                .padding(.horizontal, 4)
                        } else {
                            ForEach(columnTasks, id: \.id) { task in
                                TaskRowView(task: task)
                            }
                        }
                    }
                }
            }
            .padding()
        }
        .background(TaskifyTheme.boardBackground)
        .navigationTitle(board.name)
    }

    private var columns: [ColumnItem] {
        guard let json = board.columnsJSON?.data(using: .utf8),
              let raw = try? JSONSerialization.jsonObject(with: json) as? [[String: Any]]
        else {
            return [ColumnItem(id: "items", name: "Items")]
        }
        let cols = raw.compactMap { item -> ColumnItem? in
            guard let id = item["id"] as? String, let name = item["name"] as? String else { return nil }
            return ColumnItem(id: id, name: name)
        }
        return cols.isEmpty ? [ColumnItem(id: "items", name: "Items")] : cols
    }

    private func tasksForColumn(_ id: String) -> [TaskifyTask] {
        tasks.filter { ($0.column?.isEmpty == false ? $0.column : "items") == id }
    }
}
