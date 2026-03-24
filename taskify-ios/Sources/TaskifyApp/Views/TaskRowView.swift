import SwiftUI
import TaskifyCore

struct TaskRowView: View {
    let task: TaskifyTask
    var toggle: (() -> Void)? = nil
    var open: (() -> Void)? = nil
    var delete: (() -> Void)? = nil

    var body: some View {
        Button(action: { open?() }) {
            HStack(alignment: .center, spacing: 12) {
                Button(action: { toggle?() }) {
                    Circle()
                        .fill(Color.white.opacity(0.14))
                        .overlay(Circle().stroke(Color.white.opacity(0.20), lineWidth: 1))
                        .frame(width: 33, height: 33)
                }
                .buttonStyle(.plain)

                Text(task.title)
                    .font(.title3.weight(.medium))
                    .strikethrough(task.completed, color: TaskifyTheme.textSecondary)
                    .foregroundStyle(task.completed ? TaskifyTheme.textSecondary : TaskifyTheme.textPrimary)
                    .multilineTextAlignment(.leading)

                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .background(
                LinearGradient(colors: [Color.white.opacity(0.17), Color.white.opacity(0.05)], startPoint: .top, endPoint: .bottom)
            )
            .pwaSurface(cornerRadius: 23, fill: TaskifyTheme.pwaTask, stroke: TaskifyTheme.pwaTaskStroke)
        }
        .buttonStyle(.plain)
        .contextMenu {
            Button(task.completed ? "Mark Incomplete" : "Mark Complete") { toggle?() }
            Button("Edit") { open?() }
            Divider()
            Button("Delete", role: .destructive) { delete?() }
        }
    }
}


