import SwiftUI
import TaskifyCore

struct TaskCardView: View {
    let task: BoardTaskItem
    var priority: Int? = nil
    var subtasksJSON: String? = nil
    var dueTimeEnabled: Bool = false
    var streak: Int? = nil
    var hasRecurrence: Bool = false
    var onToggleComplete: (() -> Void)? = nil
    var onTap: (() -> Void)? = nil
    var onToggleSubtask: ((String) -> Void)? = nil

    private var parsedSubtasks: [Subtask] {
        guard let json = subtasksJSON, let data = json.data(using: .utf8),
              let arr = try? JSONDecoder().decode([Subtask].self, from: data) else { return [] }
        return arr
    }

    private var priorityLevel: TaskPriority {
        TaskPriority(rawValue: priority ?? 0) ?? .none
    }

    private var formattedDueDate: String? {
        guard let iso = task.dueISO, !iso.isEmpty else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = formatter.date(from: iso) ?? ISO8601DateFormatter().date(from: iso) else { return nil }

        let cal = Calendar.current
        if cal.isDateInToday(date) { return dueTimeEnabled ? "Today \(timeString(date))" : "Today" }
        if cal.isDateInTomorrow(date) { return dueTimeEnabled ? "Tomorrow \(timeString(date))" : "Tomorrow" }
        if cal.isDateInYesterday(date) { return dueTimeEnabled ? "Yesterday \(timeString(date))" : "Yesterday" }

        let df = DateFormatter()
        df.dateFormat = dueTimeEnabled ? "EEE, MMM d 'at' h:mm a" : "EEE, MMM d"
        return df.string(from: date)
    }

    private func timeString(_ date: Date) -> String {
        let df = DateFormatter()
        df.dateFormat = "h:mm a"
        return df.string(from: date)
    }

    private var isOverdue: Bool {
        guard let iso = task.dueISO, !iso.isEmpty, !task.completed else { return false }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = formatter.date(from: iso) ?? ISO8601DateFormatter().date(from: iso) else { return false }
        return date < Date()
    }

    private var subtaskSummary: String? {
        let subs = parsedSubtasks
        guard !subs.isEmpty else { return nil }
        let done = subs.filter(\.completed).count
        return "\(done)/\(subs.count)"
    }

    var body: some View {
        Button(action: { onTap?() }) {
            HStack(alignment: .top, spacing: 12) {
                // Completion button
                Button(action: { onToggleComplete?() }) {
                    Image(systemName: task.completed ? "checkmark.circle.fill" : "circle")
                        .font(.title3)
                        .foregroundStyle(task.completed ? .green : .secondary)
                }
                .buttonStyle(.plain)

                VStack(alignment: .leading, spacing: 4) {
                    // Title row with priority
                    HStack(spacing: 4) {
                        if priorityLevel != .none {
                            Text(priorityLevel.marks)
                                .font(.subheadline.bold())
                                .foregroundStyle(priorityColor)
                        }
                        Text(task.title)
                            .font(.subheadline)
                            .strikethrough(task.completed, color: .secondary)
                            .foregroundStyle(task.completed ? .secondary : .primary)
                            .lineLimit(3)
                    }

                    // Meta row: due date, streak, recurrence, subtask count
                    HStack(spacing: 8) {
                        if let due = formattedDueDate {
                            Label(due, systemImage: "calendar")
                                .font(.caption)
                                .foregroundStyle(isOverdue ? .red : .secondary)
                        }

                        if hasRecurrence {
                            Image(systemName: "repeat")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }

                        if let s = streak, s > 0, hasRecurrence {
                            HStack(spacing: 2) {
                                Image(systemName: "flame.fill")
                                    .foregroundStyle(.orange)
                                Text("\(s)")
                            }
                            .font(.caption)
                        }

                        if let summary = subtaskSummary {
                            Label(summary, systemImage: "checklist")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }

                    // Inline subtasks (collapsed to first 3)
                    let subs = parsedSubtasks
                    if !subs.isEmpty && !task.completed {
                        VStack(alignment: .leading, spacing: 2) {
                            ForEach(subs.prefix(3)) { sub in
                                HStack(spacing: 6) {
                                    Button(action: { onToggleSubtask?(sub.id) }) {
                                        Image(systemName: sub.completed ? "checkmark.square.fill" : "square")
                                            .font(.caption)
                                            .foregroundStyle(sub.completed ? .green : .secondary)
                                    }
                                    .buttonStyle(.plain)

                                    Text(sub.title)
                                        .font(.caption)
                                        .strikethrough(sub.completed)
                                        .foregroundStyle(sub.completed ? .secondary : .primary)
                                        .lineLimit(1)
                                }
                            }
                            if subs.count > 3 {
                                Text("+\(subs.count - 3) more")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .padding(.top, 2)
                    }
                }

                Spacer(minLength: 0)
            }
            .padding(.vertical, 8)
            .padding(.horizontal, 12)
            .background(Color(.systemBackground))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var priorityColor: Color {
        switch priorityLevel {
        case .none: return .clear
        case .low: return .blue
        case .medium: return .orange
        case .high: return .red
        }
    }
}
