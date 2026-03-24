import SwiftUI
import SwiftData
import TaskifyCore

enum AppTab: String, CaseIterable {
    case boards, upcoming, wallet, contacts, settings

    var title: String {
        switch self {
        case .boards: return "Boards"
        case .upcoming: return "Upcoming"
        case .wallet: return "Wallet"
        case .contacts: return "Contacts"
        case .settings: return "Settings"
        }
    }

    var icon: String {
        switch self {
        case .boards: return "square.grid.2x2"
        case .upcoming: return "calendar"
        case .wallet: return "wallet.pass"
        case .contacts: return "person.2"
        case .settings: return "gearshape"
        }
    }
}

struct TabShellView: View {
    @Query(sort: \TaskifyBoard.name) private var boards: [TaskifyBoard]
    @Binding var selectedBoardId: String?
    let onAddBoard: () -> Void
    let onQuickAdd: (() -> Void)?
    @State private var tab: AppTab = .boards

    var body: some View {
        ZStack(alignment: .bottom) {
            Group {
                switch tab {
                case .boards:
                    if let board = selectedBoard {
                        BoardDetailView(board: board)
                    } else {
                        BoardListView(selectedBoardId: $selectedBoardId, onAddBoard: onAddBoard)
                    }
                case .upcoming:
                    UpcomingView()
                case .wallet:
                    placeholder(title: "Wallet", icon: "wallet.pass", text: "Wallet screen comes next.")
                case .contacts:
                    placeholder(title: "Contacts", icon: "person.2", text: "Contacts screen comes next.")
                case .settings:
                    SettingsView {
                        tab = .boards
                    }
                }
            }

            bottomBar
                .padding(.horizontal, 14)
                .padding(.bottom, 7)
        }
        .taskifyScreen()
    }

    private var selectedBoard: TaskifyBoard? {
        if let selectedBoardId,
           let board = boards.first(where: { $0.id == selectedBoardId }) {
            return board
        }
        return boards.first(where: { $0.kind == "week" && !$0.archived && !$0.hidden })
            ?? boards.first(where: { !$0.archived && !$0.hidden })
    }

    private var bottomBar: some View {
        HStack(spacing: 6) {
            ForEach(AppTab.allCases, id: \.rawValue) { item in
                Button {
                    tab = item
                } label: {
                    VStack(spacing: 4) {
                        Image(systemName: item.icon)
                            .font(.system(size: tab == item ? 18 : 16, weight: .semibold))
                        Text(item.title)
                            .font(.caption2.weight(.medium))
                    }
                    .foregroundStyle(tab == item ? TaskifyTheme.textPrimary : TaskifyTheme.textSecondary)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 7)
                    .background {
                        if tab == item {
                            Circle()
                                .fill(Color.white.opacity(0.17))
                                .overlay(Circle().stroke(Color.white.opacity(0.24), lineWidth: 1))
                                .frame(width: 48, height: 48)
                        }
                    }
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 7)
        .pwaSurface(cornerRadius: 26, fill: TaskifyTheme.pwaDock, stroke: TaskifyTheme.pwaBoardStroke)
    }

    private func placeholder(title: String, icon: String, text: String) -> some View {
        VStack(spacing: 16) {
            Spacer()
            Image(systemName: icon)
                .font(.system(size: 42))
                .foregroundStyle(TaskifyTheme.textSecondary)
            Text(title)
                .font(.title2.bold())
            Text(text)
                .foregroundStyle(TaskifyTheme.textSecondary)
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
