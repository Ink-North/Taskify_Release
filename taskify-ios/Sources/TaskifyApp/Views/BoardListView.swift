import SwiftUI
import SwiftData
import TaskifyCore

struct BoardListView: View {
    @Query(sort: \TaskifyBoard.name) private var boards: [TaskifyBoard]
    @Binding var selectedBoardId: String?
    let onAddBoard: () -> Void

    var body: some View {
        List(selection: $selectedBoardId) {
            Section("Boards") {
                ForEach(visibleBoards, id: \.id) { board in
                    Button {
                        selectedBoardId = board.id
                    } label: {
                        HStack(spacing: 10) {
                            Image(systemName: icon(for: board.kind))
                                .foregroundStyle(.secondary)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(board.name)
                                    .font(.body.weight(.medium))
                                    .foregroundStyle(.primary)
                                Text(board.kind.capitalized)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                        }
                        .padding(.vertical, 4)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .safeAreaInset(edge: .bottom) {
            Button(action: onAddBoard) {
                Label("Add Board", systemImage: "plus")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .padding()
            .background(.ultraThinMaterial)
        }
    }

    private var visibleBoards: [TaskifyBoard] {
        boards.filter { !$0.archived && !$0.hidden }
    }

    private func icon(for kind: String) -> String {
        switch kind {
        case "week": return "calendar"
        case "compound": return "square.stack.3d.up"
        default: return "list.bullet"
        }
    }
}
