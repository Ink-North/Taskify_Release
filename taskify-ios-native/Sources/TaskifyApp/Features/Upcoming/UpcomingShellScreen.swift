import SwiftUI
import TaskifyCore

struct UpcomingShellScreen: View {
    let profile: TaskifyProfile
    @EnvironmentObject private var dataController: DataController
    @StateObject private var viewModel = UpcomingViewModel()
    @State private var editingTask: BoardTaskItem? = nil

    var body: some View {
        NavigationStack {
            Group {
                if viewModel.groups.isEmpty && viewModel.overdueTasks.isEmpty && viewModel.noDueDateTasks.isEmpty {
                    VStack(spacing: 12) {
                        Image(systemName: "calendar.badge.checkmark")
                            .font(.largeTitle).foregroundStyle(.secondary)
                        Text("All caught up!")
                            .font(.title3.bold())
                        Text("Tasks with due dates will appear here.")
                            .font(.subheadline).foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .padding(24)
                } else {
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 16) {
                            if !viewModel.overdueTasks.isEmpty {
                                dateSection(label: "Overdue", tasks: viewModel.overdueTasks, isOverdue: true)
                            }
                            ForEach(viewModel.groups) { group in
                                dateSection(label: group.label, tasks: group.tasks, isOverdue: false)
                            }
                            if !viewModel.noDueDateTasks.isEmpty {
                                dateSection(label: "No Due Date", tasks: viewModel.noDueDateTasks, isOverdue: false)
                            }
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                    }
                }
            }
            .navigationTitle("Upcoming")
            .onAppear { loadUpcoming() }
            .sheet(item: $editingTask) { task in
                UpcomingTaskEditWrapper(task: task, dataController: dataController, onDone: {
                    loadUpcoming()
                    editingTask = nil
                })
            }
        }
    }

    @ViewBuilder
    private func dateSection(label: String, tasks: [BoardTaskItem], isOverdue: Bool) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(label).font(.subheadline.bold()).foregroundStyle(isOverdue ? .red : .primary)
                Text("\(tasks.count)")
                    .font(.caption2).foregroundStyle(.secondary)
                    .padding(.horizontal, 6).padding(.vertical, 2)
                    .background(Color.secondary.opacity(0.12))
                    .clipShape(Capsule())
                Spacer()
            }
            .padding(.horizontal, 4)

            VStack(spacing: 1) {
                ForEach(tasks) { task in
                    TaskCardView(
                        task: task, priority: task.priority, subtasksJSON: task.subtasksJSON,
                        dueTimeEnabled: task.dueTimeEnabled ?? false, streak: task.streak,
                        hasRecurrence: task.recurrenceJSON != nil,
                        onToggleComplete: {
                            Task {
                                let _ = await dataController.toggleComplete(taskId: task.id)
                                loadUpcoming()
                            }
                        },
                        onTap: { editingTask = task }
                    )
                    .swipeActions(edge: .trailing) {
                        Button {
                            Task {
                                let _ = await dataController.toggleComplete(taskId: task.id)
                                loadUpcoming()
                            }
                        } label: {
                            Label("Complete", systemImage: "checkmark")
                        }
                        .tint(.green)
                    }

                    if task.id != tasks.last?.id {
                        Divider().padding(.leading, 48)
                    }
                }
            }
            .background(Color(.systemBackground))
            .clipShape(RoundedRectangle(cornerRadius: 10))
        }
    }

    private func loadUpcoming() {
        let boardIds = profile.boards.map(\.id)
        let tasks = dataController.fetchUpcomingTasks(boardIds: boardIds)
        viewModel.setTasks(tasks)
    }
}

// MARK: - Wrapper to configure edit VM outside ViewBuilder

private struct UpcomingTaskEditWrapper: View {
    let task: BoardTaskItem
    let dataController: DataController
    let onDone: () -> Void

    @StateObject private var vm: TaskEditViewModel

    init(task: BoardTaskItem, dataController: DataController, onDone: @escaping () -> Void) {
        self.task = task
        self.dataController = dataController
        self.onDone = onDone
        let loc = TaskLocation(boardId: task.boardId ?? "", boardName: task.boardName ?? "", columnId: task.columnId)
        _vm = StateObject(wrappedValue: TaskEditViewModel.forEdit(task: task, location: loc))
    }

    var body: some View {
        TaskEditView(viewModel: vm)
            .onAppear {
                vm.onSave = { editVM in
                    Task {
                        let _ = await dataController.updateTask(taskId: task.id, from: editVM)
                        onDone()
                    }
                }
            }
    }
}
