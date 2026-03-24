import SwiftUI
import SwiftData
import TaskifyCore

struct UpcomingView: View {
    @Environment(\.modelContext) private var modelContext
    @EnvironmentObject private var viewModel: AppViewModel
    @Query(sort: [SortDescriptor(\TaskifyTask.createdAt, order: .reverse)]) private var tasks: [TaskifyTask]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Text("Upcoming")
                    .font(.system(size: 32, weight: .bold, design: .rounded))
                Text("Calendar-like focus for what’s next.")
                    .font(.subheadline)
                    .foregroundStyle(TaskifyTheme.textSecondary)

                ForEach(sections, id: \.title) { section in
                    GlassSectionCard(title: section.title, subtitle: section.subtitle) {
                        VStack(spacing: 10) {
                            if section.tasks.isEmpty {
                                Text("Nothing here")
                                    .font(.subheadline)
                                    .foregroundStyle(TaskifyTheme.textSecondary)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            } else {
                                ForEach(section.tasks, id: \.id) { task in
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

    private var sections: [(title: String, subtitle: String, tasks: [TaskifyTask])] {
        let open = tasks.filter { !$0.completed && !$0.deleted }
        let now = Calendar.current.startOfDay(for: Date())
        let tomorrow = Calendar.current.date(byAdding: .day, value: 1, to: now)!
        let nextWeek = Calendar.current.date(byAdding: .day, value: 7, to: now)!

        func dueDate(_ task: TaskifyTask) -> Date? {
            guard let due = task.dueISO else { return nil }
            return ISO8601DateFormatter().date(from: due)
        }

        let today = open.filter { guard let d = dueDate($0) else { return false }; return Calendar.current.isDate(d, inSameDayAs: now) }
        let tomorrowTasks = open.filter { guard let d = dueDate($0) else { return false }; return Calendar.current.isDate(d, inSameDayAs: tomorrow) }
        let soon = open.filter { guard let d = dueDate($0) else { return false }; return d > tomorrow && d < nextWeek }
        let unscheduled = open.filter { dueDate($0) == nil }

        return [
            ("Today", "Immediate focus", today),
            ("Tomorrow", "Coming up next", tomorrowTasks),
            ("Soon", "This week", soon),
            ("Unscheduled", "Inbox-style tasks", unscheduled),
        ]
    }
}
