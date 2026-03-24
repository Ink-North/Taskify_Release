import SwiftUI
import TaskifyCore

struct BoardDetailView: View {
    let board: TaskifyBoard

    var body: some View {
        Group {
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
}

private struct CompoundBoardPlaceholderView: View {
    let board: TaskifyBoard

    var body: some View {
        VStack(spacing: 18) {
            Spacer(minLength: 0)
            VStack(spacing: 16) {
                Image(systemName: "square.stack.3d.up")
                    .font(.system(size: 42, weight: .medium))
                    .foregroundStyle(TaskifyTheme.textSecondary)
                Text(board.name)
                    .font(.title2.bold())
                Text("Compound board support is next. I’m aligning the week and list board experience to the PWA first, then folding compound boards into the same structure.")
                    .font(.body)
                    .foregroundStyle(TaskifyTheme.textSecondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)
            }
            .padding(24)
            .frame(maxWidth: .infinity)
            .frostedGlass(cornerRadius: 30)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .padding(.top, 18)
        .padding(.bottom, 140)
        .taskifyScreen()
    }
}
