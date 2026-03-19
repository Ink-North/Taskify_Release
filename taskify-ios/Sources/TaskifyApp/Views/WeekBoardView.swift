import SwiftUI
import SwiftData
import TaskifyCore

struct WeekBoardView: View {
    let board: TaskifyBoard
    @Query private var tasks: [TaskifyTask]

    private let weekdays = Calendar.current.weekdaySymbols

    init(board: TaskifyBoard) {
        self.board = board
        let boardId = board.id
        _tasks = Query(filter: #Predicate<TaskifyTask> { task in
            task.boardId == boardId && task.deleted == false
        }, sort: [SortDescriptor(\TaskifyTask.createdAt, order: .reverse)])
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                ForEach(weekBuckets, id: \.day) { bucket in
                    VStack(alignment: .leading, spacing: 10) {
                        Text(bucket.day)
                            .font(.headline)
                            .padding(.horizontal, 4)
                        if bucket.tasks.isEmpty {
                            Text("No tasks")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                                .padding(.horizontal, 4)
                        } else {
                            ForEach(bucket.tasks, id: \.id) { task in
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

    private var weekBuckets: [(day: String, tasks: [TaskifyTask])] {
        let openTasks = tasks.filter { !$0.completed }
        let grouped = Dictionary(grouping: openTasks) { task in
            weekdayLabel(for: task)
        }
        return weekdays.map { day in
            (day: day, tasks: grouped[day] ?? [])
        }
    }

    private func weekdayLabel(for task: TaskifyTask) -> String {
        guard let due = task.dueISO, !due.isEmpty,
              let date = ISO8601DateFormatter().date(from: due) else {
            return weekdays[Calendar.current.component(.weekday, from: Date()) - 1]
        }
        return weekdays[Calendar.current.component(.weekday, from: date) - 1]
    }
}
