import SwiftUI
import SwiftData
import TaskifyCore

struct ListsBoardView: View {
    let board: TaskifyBoard
    @Environment(\.modelContext) private var modelContext
    @EnvironmentObject private var viewModel: AppViewModel
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
            VStack(alignment: .leading, spacing: 18) {
                header
                ForEach(columns, id: \.id) { column in
                    GlassSectionCard(title: column.name, subtitle: "List") {
                        let columnTasks = tasksForColumn(column.id)
                        VStack(spacing: 10) {
                            if columnTasks.isEmpty {
                                Text("No tasks")
                                    .font(.subheadline)
                                    .foregroundStyle(TaskifyTheme.textSecondary)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            } else {
                                ForEach(columnTasks, id: \.id) { task in
                                    TaskRowView(
                                        task: task,
                                        toggle: { try? viewModel.toggleTask(task, context: modelContext) },
                                        open: { viewModel.openEditor(for: task) },
                                        delete: { try? viewModel.deleteTask(task, context: modelContext) }
                                    )
                                }
                            }
                        }
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 18)
            .padding(.bottom, 140)
        }
        .taskifyScreen()
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(board.name)
                .font(.system(size: 32, weight: .bold, design: .rounded))
            Text("Lists")
                .font(.subheadline)
                .foregroundStyle(TaskifyTheme.textSecondary)
        }
    }

    private var columns: [BoardColumn] {
        guard let json = board.columnsJSON?.data(using: .utf8),
              let cols = try? JSONDecoder().decode([BoardColumn].self, from: json),
              !cols.isEmpty else {
            return [BoardColumn(id: "items", name: "Items")]
        }
        return cols
    }

    private func tasksForColumn(_ columnId: String) -> [TaskifyTask] {
        tasks.filter { ($0.column ?? "items") == columnId && !$0.completed }
    }
}
