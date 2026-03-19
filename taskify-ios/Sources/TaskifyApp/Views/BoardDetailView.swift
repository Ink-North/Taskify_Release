import SwiftUI
import TaskifyCore

struct BoardDetailView: View {
    let board: TaskifyBoard

    var body: some View {
        switch board.kind {
        case "week":
            WeekBoardView(board: board)
        case "lists":
            ListsBoardView(board: board)
        case "compound":
            CompoundBoardPlaceholderView(board: board)
        default:
            ListsBoardView(board: board)
        }
    }
}

private struct CompoundBoardPlaceholderView: View {
    let board: TaskifyBoard

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "square.stack.3d.up")
                .font(.system(size: 44))
                .foregroundStyle(.secondary)
            Text(board.name)
                .font(.title2.weight(.semibold))
            Text("Compound boards are next in Phase 2/3. The shell is ready for PWA-parity expansion.")
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
                .padding(.horizontal)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(TaskifyTheme.boardBackground)
        .navigationTitle(board.name)
    }
}
