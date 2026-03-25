import SwiftUI
import TaskifyCore

struct BoardsShellScreen: View {
    @ObservedObject var shellVM: AppShellViewModel
    @StateObject private var boardListVM = BoardListViewModel()
    @StateObject private var boardDetailVM = BoardDetailViewModel()
    @StateObject private var boardModeVM = BoardModeViewModel()
    @StateObject private var headerVM = BoardHeaderControlsViewModel(completedTabEnabled: true, canShareBoard: true)

    var body: some View {
        NavigationStack {
            VStack(spacing: 12) {
                switch boardListVM.state {
                case .loading:
                    ProgressView("Loading boards…")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                case .empty:
                    VStack(spacing: 12) {
                        Image(systemName: "tray")
                            .font(.title2)
                            .foregroundStyle(.secondary)
                        Text(shellVM.boardsEmptyMessage)
                            .font(.subheadline)
                            .multilineTextAlignment(.center)
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .padding(24)
                case .error(let message):
                    VStack(spacing: 12) {
                        Image(systemName: "exclamationmark.triangle")
                            .font(.title2)
                            .foregroundStyle(.orange)
                        Text(message)
                            .font(.subheadline)
                            .multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .padding(24)
                case .ready:
                    Picker("Boards", selection: Binding(
                        get: { boardListVM.selectedBoardId ?? "" },
                        set: { boardListVM.selectBoard(id: $0) }
                    )) {
                        ForEach(boardListVM.visibleBoards, id: \.id) { board in
                            Text(board.name).tag(board.id)
                        }
                    }
                    .pickerStyle(.menu)

                    HStack(spacing: 10) {
                        if headerVM.canShareBoard {
                            Button("Share") { headerVM.openShareBoard() }
                                .buttonStyle(.bordered)
                        }

                        Button("Completed") {
                            headerVM.primaryCompletedAction()
                            boardModeVM.setMode(headerVM.mode)
                        }
                        .buttonStyle(.bordered)

                        Button("Board Upcoming") {
                            headerVM.toggleBoardUpcomingMode()
                            boardModeVM.setMode(headerVM.mode)
                        }
                        .buttonStyle(.bordered)

                        Button("Filter/Sort") { headerVM.openFilterSort() }
                            .buttonStyle(.bordered)
                    }

                    Picker("Board Mode", selection: Binding(
                        get: { boardModeVM.mode },
                        set: {
                            boardModeVM.setMode($0)
                            headerVM.bind(mode: $0)
                        }
                    )) {
                        Text("Board").tag(BoardPageMode.board)
                        Text("Upcoming").tag(BoardPageMode.boardUpcoming)
                        Text("Completed").tag(BoardPageMode.completed)
                    }
                    .pickerStyle(.segmented)

                    BoardModePane(modeVM: boardModeVM, detailVM: boardDetailVM)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .padding(.horizontal, 12)
            .padding(.top, 8)
            .navigationTitle("Boards")
            .onAppear {
                boardListVM.setBoards(shellVM.profile.boards)
                boardDetailVM.setSelectedBoard(id: boardListVM.selectedBoardId)
                seedBoardModeState()
                headerVM.bind(mode: boardModeVM.mode)
            }
            .onChange(of: boardListVM.selectedBoardId) { _, newValue in
                boardDetailVM.setSelectedBoard(id: newValue)
                seedBoardModeState()
            }
            .onChange(of: boardModeVM.mode) { _, newValue in
                headerVM.bind(mode: newValue)
            }
        }
    }

    private func seedBoardModeState() {
        boardModeVM.setBoardItems(boardDetailVM.visibleTasks.map(\.id))
        boardModeVM.setUpcomingItems([])
        boardModeVM.setCompletedItems(boardDetailVM.visibleTasks.filter(\.completed).map(\.id))
    }
}

struct BoardModePane: View {
    @ObservedObject var modeVM: BoardModeViewModel
    @ObservedObject var detailVM: BoardDetailViewModel

    var body: some View {
        Group {
            switch modeVM.currentState {
            case .loading(let text):
                ProgressView(text)
            case .error(let message):
                VStack(spacing: 10) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.title2)
                        .foregroundStyle(.orange)
                    Text(message)
                        .font(.subheadline)
                }
            case .empty(let message):
                VStack(spacing: 10) {
                    Image(systemName: "checklist")
                        .font(.title2)
                        .foregroundStyle(.secondary)
                    Text(message)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            case .ready:
                switch modeVM.mode {
                case .board:
                    BoardDetailPane(viewModel: detailVM)
                case .boardUpcoming:
                    Text("Board upcoming list scaffold")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                case .completed:
                    List(detailVM.visibleTasks.filter(\.completed)) { task in
                        HStack(spacing: 10) {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundStyle(.green)
                            Text(task.title)
                            Spacer()
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct BoardDetailPane: View {
    @ObservedObject var viewModel: BoardDetailViewModel

    var body: some View {
        Group {
            switch viewModel.state {
            case .loading:
                ProgressView("Loading tasks…")
            case .empty:
                VStack(spacing: 10) {
                    Image(systemName: "checklist")
                        .font(.title2)
                        .foregroundStyle(.secondary)
                    Text(viewModel.emptyMessage)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            case .error(let message):
                VStack(spacing: 10) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.title2)
                        .foregroundStyle(.orange)
                    Text(message)
                        .font(.subheadline)
                }
            case .ready:
                List(viewModel.visibleTasks) { task in
                    HStack(spacing: 10) {
                        Image(systemName: task.completed ? "checkmark.circle.fill" : "circle")
                            .foregroundStyle(task.completed ? .green : .secondary)
                        Text(task.title)
                        Spacer()
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
