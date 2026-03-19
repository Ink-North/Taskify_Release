import SwiftUI
import TaskifyCore

struct TaskRowView: View {
    let task: TaskifyTask
    var toggle: (() -> Void)? = nil

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Button(action: { toggle?() }) {
                Image(systemName: task.completed ? "checkmark.circle.fill" : "circle")
                    .font(.title3)
                    .foregroundStyle(task.completed ? TaskifyTheme.done : .secondary)
            }
            .buttonStyle(.plain)

            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .center, spacing: 8) {
                    Text(task.title)
                        .font(.body.weight(.medium))
                        .strikethrough(task.completed, color: .secondary)
                        .foregroundStyle(task.completed ? .secondary : .primary)
                    if let priority = task.priority {
                        PriorityBadge(priority: priority)
                    }
                }

                if let note = task.note, !note.isEmpty {
                    Text(note)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }

                HStack(spacing: 8) {
                    if let due = task.dueISO, !due.isEmpty {
                        Label(formattedDue(due), systemImage: "calendar")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    if let column = task.column, !column.isEmpty {
                        Text(column)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(Color.primary.opacity(0.06))
                            .clipShape(Capsule())
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .taskifyCardStyle()
    }

    private func formattedDue(_ iso: String) -> String {
        guard let date = ISO8601DateFormatter().date(from: iso) else { return iso }
        return date.formatted(date: .abbreviated, time: .omitted)
    }
}

private struct PriorityBadge: View {
    let priority: Int

    var body: some View {
        Text(label)
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(color.opacity(0.15))
            .foregroundStyle(color)
            .clipShape(Capsule())
    }

    private var label: String {
        switch priority {
        case 1: return "High"
        case 2: return "Med"
        default: return "Low"
        }
    }

    private var color: Color {
        switch priority {
        case 1: return TaskifyTheme.priorityHigh
        case 2: return TaskifyTheme.priorityMedium
        default: return TaskifyTheme.priorityLow
        }
    }
}
