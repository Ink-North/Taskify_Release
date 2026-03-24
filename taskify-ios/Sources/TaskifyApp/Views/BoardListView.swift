import SwiftUI
import SwiftData
import TaskifyCore

struct BoardListView: View {
    @Query(sort: \TaskifyBoard.name) private var boards: [TaskifyBoard]
    @Binding var selectedBoardId: String?
    let onAddBoard: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                headerBar
                boardSurface
            }
            .padding(.horizontal, 16)
            .padding(.top, 12)
            .padding(.bottom, 140)
        }
        .taskifyScreen()
    }

    private var headerBar: some View {
        HStack(spacing: 12) {
            Button(action: {}) {
                HStack(spacing: 10) {
                    Image(systemName: "square.grid.2x2")
                    Text(selectedBoardTitle)
                        .fontWeight(.semibold)
                    Image(systemName: "chevron.down")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(TaskifyTheme.textSecondary)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
            }
            .buttonStyle(.plain)
            .frostedGlass(cornerRadius: 22, tint: Color.white.opacity(0.10), stroke: TaskifyTheme.strokeStrong)

            Spacer(minLength: 0)

            Button(action: onAddBoard) {
                Image(systemName: "plus")
                    .font(.system(size: 18, weight: .bold))
                    .frame(width: 44, height: 44)
            }
            .buttonStyle(.plain)
            .frostedGlass(cornerRadius: 22, tint: TaskifyTheme.accent.opacity(0.14), stroke: TaskifyTheme.strokeStrong)
        }
    }

    private var boardSurface: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .center) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Boards")
                        .font(.system(size: 28, weight: .bold, design: .rounded))
                    Text("Open a workspace or create a new one")
                        .font(.subheadline)
                        .foregroundStyle(TaskifyTheme.textSecondary)
                }
                Spacer()
            }

            VStack(spacing: 12) {
                ForEach(visibleBoards, id: \.id) { board in
                    Button {
                        selectedBoardId = board.id
                    } label: {
                        HStack(spacing: 14) {
                            ZStack {
                                RoundedRectangle(cornerRadius: 14, style: .continuous)
                                    .fill(iconBackground(for: board.kind))
                                    .frame(width: 46, height: 46)
                                Image(systemName: icon(for: board.kind))
                                    .foregroundStyle(TaskifyTheme.textPrimary)
                                    .font(.system(size: 18, weight: .semibold))
                            }

                            VStack(alignment: .leading, spacing: 4) {
                                Text(board.name)
                                    .font(.body.weight(.semibold))
                                    .foregroundStyle(TaskifyTheme.textPrimary)
                                Text(label(for: board.kind))
                                    .font(.caption)
                                    .foregroundStyle(TaskifyTheme.textSecondary)
                            }

                            Spacer(minLength: 0)

                            if selectedBoardId == board.id {
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundStyle(TaskifyTheme.accent)
                                    .font(.title3)
                            } else {
                                Image(systemName: "chevron.right")
                                    .font(.caption.weight(.bold))
                                    .foregroundStyle(TaskifyTheme.textTertiary)
                            }
                        }
                        .padding(.horizontal, 14)
                        .padding(.vertical, 14)
                        .background(.thinMaterial)
                        .background(selectedBoardId == board.id ? TaskifyTheme.accent.opacity(0.12) : Color.white.opacity(0.04))
                        .overlay(
                            RoundedRectangle(cornerRadius: 22, style: .continuous)
                                .stroke(selectedBoardId == board.id ? TaskifyTheme.strokeStrong : TaskifyTheme.stroke, lineWidth: 1)
                        )
                        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .frostedGlass(cornerRadius: 30, tint: Color.white.opacity(0.08), stroke: TaskifyTheme.strokeStrong)
    }

    private var visibleBoards: [TaskifyBoard] {
        boards.filter { !$0.archived && !$0.hidden }
    }

    private var selectedBoardTitle: String {
        if let selectedBoardId,
           let selected = boards.first(where: { $0.id == selectedBoardId }) {
            return selected.name
        }
        return visibleBoards.first?.name ?? "Boards"
    }

    private func icon(for kind: String) -> String {
        switch kind {
        case "week": return "calendar"
        case "compound": return "square.stack.3d.up"
        default: return "list.bullet.rectangle"
        }
    }

    private func label(for kind: String) -> String {
        switch kind {
        case "week": return "Week board"
        case "compound": return "Compound board"
        default: return "List board"
        }
    }

    private func iconBackground(for kind: String) -> Color {
        switch kind {
        case "week": return TaskifyTheme.accentSoft
        case "compound": return Color.purple.opacity(0.25)
        default: return Color.white.opacity(0.10)
        }
    }
}
