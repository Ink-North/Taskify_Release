import SwiftUI
import TaskifyCore

struct BoardsShellScreen: View {
    @ObservedObject var shellVM: AppShellViewModel
    @EnvironmentObject private var dataController: DataController
    @EnvironmentObject private var settingsManager: SettingsManager
    @StateObject private var boardListVM = BoardListViewModel()
    @StateObject private var boardDetailVM = BoardDetailViewModel()
    @StateObject private var boardModeVM = BoardModeViewModel()
    @StateObject private var headerVM = BoardHeaderControlsViewModel(completedTabEnabled: true, canShareBoard: true)
    @StateObject private var listColumnsVM = ListColumnsViewModel()

    @State private var showShareSheet = false
    @State private var showFilterSortSheet = false
    @State private var showCreateBoard = false
    @State private var showManageBoard = false
    @State private var lastClearCompletedCount = 0
    @State private var editingTask: BoardTaskItem? = nil
    @State private var showCreateTask = false
    @State private var quickAddTitle = ""
    @FocusState private var quickAddFocused: Bool

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                switch boardListVM.state {
                case .loading:
                    ProgressView("Loading boards…")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                case .empty:
                    emptyBoardsView
                case .error(let message):
                    VStack(spacing: 12) {
                        Image(systemName: "exclamationmark.triangle")
                            .font(.title2).foregroundStyle(.orange)
                        Text(message).font(.subheadline).multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .padding(24)
                case .ready:
                    boardContentView
                }
            }
            .navigationTitle("Boards")
            .toolbar { toolbarItems }
            .onAppear { bootstrapBoards() }
            .onChange(of: boardListVM.selectedBoardId) { _, newValue in
                Task { await loadBoardTasks(boardId: newValue) }
            }
            .onChange(of: dataController.activeBoardItems) { _, items in
                guard let selectedBoardId = boardListVM.selectedBoardId else { return }
                boardDetailVM.setTasks(for: selectedBoardId, tasks: items)
                syncState()
            }
            .onChange(of: dataController.boardDefinitionsVersion) { _, _ in
                boardListVM.setBoards(availableNavigationBoards, preferredBoardId: preferredStartupBoardId)
                syncState()
            }
            .onChange(of: boardModeVM.mode) { _, newValue in
                headerVM.bind(mode: newValue)
            }
            .onChange(of: settingsManager.settings.completedTab) { _, enabled in
                if !enabled, boardModeVM.mode != .board {
                    boardModeVM.setMode(.board)
                    headerVM.bind(mode: .board)
                }
            }
            .sheet(item: $editingTask) { task in taskEditSheet(for: task) }
            .sheet(isPresented: $showCreateTask) { taskCreateSheet() }
            .sheet(isPresented: $showCreateBoard) { CreateBoardSheet(onCreated: { bootstrapBoards() }) }
            .sheet(isPresented: $showShareSheet) { shareBoardSheet }
            .sheet(isPresented: $showFilterSortSheet) { filterSortSheet() }
            .sheet(isPresented: $showManageBoard) { manageBoardSheet }
        }
    }

    // MARK: - Empty boards

    private var emptyBoardsView: some View {
        VStack(spacing: 16) {
            Image(systemName: "tray")
                .font(.system(size: 48))
                .foregroundStyle(.secondary)
            Text("No boards yet")
                .font(.title3.bold())
            Text("Create a new board or join an existing one to get started.")
                .font(.subheadline).foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button(action: { showCreateBoard = true }) {
                Label("Create Board", systemImage: "plus.circle.fill")
            }
            .buttonStyle(.borderedProminent)

            Button(action: { showCreateBoard = true }) {
                Label("Join Board", systemImage: "person.badge.plus")
            }
            .buttonStyle(.bordered)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(24)
    }

    // MARK: - Main board content

    private var boardContentView: some View {
        VStack(spacing: 0) {
            VStack(spacing: 12) {
                HStack(alignment: .center, spacing: 12) {
                    HStack(spacing: 10) {
                        boardPickerButton

                        if canShareSelectedBoard {
                            BoardHeaderIconButton(
                                systemName: "square.and.arrow.up",
                                accessibilityLabel: "Share board",
                                action: { headerVM.openShareBoard() }
                            )
                        }
                    }

                    Spacer(minLength: 0)

                    HStack(spacing: 8) {
                        syncStatusIndicator
                        boardHeaderActions

                        if canCreateTaskFromHeader {
                            BoardHeaderIconButton(
                                systemName: "plus",
                                accessibilityLabel: "Add task",
                                action: { showCreateTask = true }
                            )
                        }
                    }
                }

                if showsTopQuickAddBar {
                    HStack(spacing: 8) {
                        Image(systemName: "plus")
                            .foregroundStyle(.secondary)
                            .font(.subheadline)
                        TextField("Quick add task…", text: $quickAddTitle)
                            .focused($quickAddFocused)
                            .onSubmit { Task { await quickAddTask() } }
                            .textFieldStyle(.plain)
                            .font(.subheadline)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 9)
                    .background(Color.secondary.opacity(0.08))
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                }
            }
            .padding(.horizontal, 14)
            .padding(.top, 8)

            InteractiveBoardModePane(
                modeVM: boardModeVM,
                detailVM: boardDetailVM,
                listColumnsVM: listColumnsVM,
                usesColumnLayout: usesColumnBoardLayout,
                showsIndexLane: showsIndexLane,
                usesWeekLayout: showsWeekBoardLayout,
                weekStart: settingsManager.settings.weekStart,
                allowsInlineTaskEntry: allowsInlineTaskEntry,
                allowsListCreation: allowsListCreation,
                hideCompletedSubtasks: settingsManager.settings.hideCompletedSubtasks,
                showsStreaks: settingsManager.settings.streaksEnabled,
                showsCompletedTasksInBoard: !settingsManager.settings.completedTab,
                onToggleComplete: { taskId in
                    Task {
                        if let updated = await dataController.toggleComplete(taskId: taskId) {
                            boardDetailVM.updateTask(updated)
                            syncState()
                        }
                    }
                },
                onTapTask: { task in editingTask = task },
                onToggleSubtask: { taskId, subtaskId in
                    Task {
                        if let updated = await dataController.toggleSubtask(taskId: taskId, subtaskId: subtaskId) {
                            boardDetailVM.updateTask(updated)
                        }
                    }
                },
                onInlineAddTask: { columnId, title in
                    handleInlineTaskAdd(columnId: columnId, title: title)
                },
                onAddList: { name in
                    handleListAdd(name: name)
                },
                onRefresh: {
                    await loadBoardTasks(boardId: boardListVM.selectedBoardId)
                }
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private var boardPickerButton: some View {
        Menu {
            ForEach(boardListVM.visibleBoards, id: \.id) { board in
                Button(action: { boardListVM.selectBoard(id: board.id) }) {
                    HStack {
                        Text(board.name)
                        if board.id == boardListVM.selectedBoardId {
                            Image(systemName: "checkmark")
                        }
                    }
                }
            }
            Divider()
            Button(action: { showManageBoard = true }) {
                Label("Board Settings", systemImage: "gearshape")
            }
        } label: {
            HStack(spacing: 8) {
                Text(selectedBoardName)
                    .font(.headline)
                    .lineLimit(1)
                    .foregroundStyle(.primary)
                Image(systemName: "chevron.down")
                    .font(.caption.bold())
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(Color.secondary.opacity(0.08))
            .clipShape(Capsule())
        }
    }

    @ViewBuilder
    private var syncStatusIndicator: some View {
        if dataController.syncing {
            ProgressView()
                .scaleEffect(0.7)
        } else if dataController.relayConnected > 0 {
            HStack(spacing: 4) {
                Image(systemName: "antenna.radiowaves.left.and.right")
                    .font(.caption)
                    .foregroundStyle(.green)
                Text("\(dataController.relayConnected)")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            .padding(.trailing, 2)
        } else {
            Image(systemName: "antenna.radiowaves.left.and.right")
                .font(.caption)
                .foregroundStyle(.orange)
                .padding(.trailing, 2)
        }
    }

    @ViewBuilder
    private var boardHeaderActions: some View {
        if settingsManager.settings.completedTab {
            BoardHeaderIconButton(
                systemName: "checkmark",
                isActive: boardModeVM.mode == .completed,
                accessibilityLabel: boardModeVM.mode == .completed ? "Show board" : "Show completed tasks",
                action: { handleCompletedHeaderAction() }
            )
        } else if clearCompletedAvailable {
            BoardHeaderIconButton(
                systemName: "trash",
                isEnabled: boardDetailVM.visibleTasks.contains(where: { $0.completed }),
                accessibilityLabel: "Clear completed tasks",
                action: { handleCompletedHeaderAction() }
            )
        }

        if showsUpcomingToggle {
            BoardHeaderIconButton(
                systemName: "calendar",
                isActive: boardModeVM.mode == .boardUpcoming,
                accessibilityLabel: boardModeVM.mode == .boardUpcoming ? "Show board" : "Show board upcoming",
                action: { handleBoardUpcomingToggle() }
            )
        }

        BoardHeaderIconButton(
            systemName: "line.3.horizontal.decrease.circle",
            accessibilityLabel: "Filter and sort",
            action: { headerVM.openFilterSort() }
        )
    }

    private var selectedBoardSettings: BoardSettingsSnapshot? {
        guard let boardId = boardListVM.selectedBoardId else { return nil }
        return dataController.boardSettings(boardId: boardId)
    }

    private var canShareSelectedBoard: Bool {
        boardListVM.selectedBoardId != nil && selectedBoardKind != "bible"
    }

    private var clearCompletedAvailable: Bool {
        !(selectedBoardSettings?.clearCompletedDisabled ?? false)
    }

    private var usesColumnBoardLayout: Bool {
        selectedBoardKind == "lists" || selectedBoardKind == "compound"
    }

    private var showsIndexLane: Bool {
        usesColumnBoardLayout && (selectedBoardSettings?.indexCardEnabled == true)
    }

    private var showsWeekBoardLayout: Bool {
        selectedBoardKind == "week"
    }

    private var allowsInlineTaskEntry: Bool {
        selectedBoardKind == "lists"
    }

    private var allowsListCreation: Bool {
        selectedBoardKind == "lists"
    }

    private var canCreateTaskFromHeader: Bool {
        guard let kind = selectedBoardKind else { return false }
        return kind != "compound" && kind != "lists" && kind != "week"
    }

    private var showsTopQuickAddBar: Bool {
        guard let kind = selectedBoardKind else { return false }
        return kind != "compound" && kind != "lists" && kind != "week"
    }

    private var showsUpcomingToggle: Bool {
        settingsManager.settings.completedTab && selectedBoardKind != "bible"
    }

    private var availableNavigationBoards: [ProfileBoardEntry] {
        let visibleBoards = dataController.profileBoardSummaries()
            .filter { !$0.archived && !$0.hidden }
            .map { ProfileBoardEntry(id: $0.id, name: $0.name) }
        return visibleBoards.isEmpty ? (dataController.currentProfile?.boards ?? shellVM.profile.boards) : visibleBoards
    }

    private var preferredStartupBoardId: String? {
        guard let preferred = settingsManager.settings.startBoardId() else { return nil }
        return availableNavigationBoards.contains(where: { $0.id == preferred }) ? preferred : nil
    }

    // MARK: - Toolbar

    @ToolbarContentBuilder
    private var toolbarItems: some ToolbarContent {
        ToolbarItemGroup(placement: PlatformToolbarPlacement.trailing) {
            if boardListVM.state == .ready {
                Button(action: { showCreateBoard = true }) {
                    Image(systemName: "folder.badge.plus")
                }
            }
        }
    }

    // MARK: - Quick add

    private func quickAddTask() async {
        let defaultCol = usesColumnBoardLayout ? listColumnsVM.listColumns.first?.id : nil
        await createQuickTask(title: quickAddTitle, columnId: defaultCol)
        quickAddTitle = ""
    }

    private func createQuickTask(
        title: String,
        columnId: String?,
        dueISO: String? = nil,
        dueDateEnabled: Bool? = nil
    ) async {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let boardId = boardListVM.selectedBoardId else { return }

        PlatformServices.impactLight()

        if let item = await dataController.quickAddTask(
            title: trimmed,
            boardId: boardId,
            columnId: columnId,
            dueISO: dueISO,
            dueDateEnabled: dueDateEnabled
        ) {
            if settingsManager.settings.newTaskPosition == .top {
                boardDetailVM.addTask(item)
            } else {
                boardDetailVM.addTaskAtEnd(item)
            }
            syncState()
        }
    }

    private func handleCompletedHeaderAction() {
        headerVM.primaryCompletedAction()

        if settingsManager.settings.completedTab {
            boardModeVM.setMode(headerVM.mode)
        } else {
            syncState()
        }
    }

    private func handleBoardUpcomingToggle() {
        headerVM.toggleBoardUpcomingMode()
        boardModeVM.setMode(headerVM.mode)
    }

    private func handleInlineTaskAdd(columnId: String, title: String) {
        Task {
            if showsWeekBoardLayout, let weekday = Int(columnId) {
                let dueISO = BoardDetailViewModel.isoForWeekday(
                    weekday,
                    weekStart: settingsManager.settings.weekStart
                )
                await createQuickTask(
                    title: title,
                    columnId: nil,
                    dueISO: dueISO,
                    dueDateEnabled: true
                )
            } else {
                await createQuickTask(title: title, columnId: columnId)
            }
        }
    }

    private func handleListAdd(name: String) {
        guard allowsListCreation,
              let boardId = boardListVM.selectedBoardId,
              listColumnsVM.addList(name: name) != nil else { return }

        let snapshot = selectedBoardSettings
        let columns = listColumnsVM.listColumns

        PlatformServices.impactLight()

        Task {
            await dataController.updateBoard(
                boardId: boardId,
                name: snapshot?.name ?? selectedBoardName,
                columns: columns,
                children: snapshot?.children.map(\.id),
                clearCompletedDisabled: snapshot?.clearCompletedDisabled,
                indexCardEnabled: snapshot?.indexCardEnabled,
                hideChildBoardNames: snapshot?.hideChildBoardNames,
                relayHints: snapshot?.relayHints
            )
            syncState()
        }
    }

    // MARK: - Edit sheets

    @ViewBuilder
    private func taskEditSheet(for task: BoardTaskItem) -> some View {
        let taskBoardId = task.boardId ?? boardListVM.selectedBoardId ?? ""
        let loc = TaskLocation(
            boardId: taskBoardId,
            boardName: task.boardName ?? selectedBoardName,
            columnId: task.columnId
        )
        let vm = TaskEditViewModel.forEdit(task: task, location: loc)
        let _ = configureEditVM(vm, task: task, columns: dataController.boardColumns(boardId: taskBoardId))
        TaskEditView(viewModel: vm)
    }

    @ViewBuilder
    private func taskCreateSheet() -> some View {
        let boardId = boardListVM.selectedBoardId ?? ""
        let boardName = selectedBoardName
        let columns = dataController.boardColumns(boardId: boardId)
        let defaultCol = columns.first?.id ?? listColumnsVM.listColumns.first?.id
        let loc = TaskLocation(boardId: boardId, boardName: boardName, columnId: defaultCol)
        let vm = TaskEditViewModel.forCreate(location: loc)
        let _ = configureCreateVM(vm, columns: columns)
        TaskEditView(viewModel: vm)
    }

    private func configureEditVM(_ vm: TaskEditViewModel, task: BoardTaskItem, columns: [BoardColumn]) -> Bool {
        vm.availableColumns = columns.isEmpty ? listColumnsVM.listColumns : columns
        vm.onSave = { editVM in
            Task {
                if let updated = await dataController.updateTask(taskId: task.id, from: editVM) {
                    boardDetailVM.updateTask(updated)
                    syncState()
                }
                editingTask = nil
            }
        }
        vm.onDelete = { taskId in
            Task {
                let _ = await dataController.deleteTask(taskId: taskId)
                boardDetailVM.deleteTask(taskId: taskId)
                syncState()
                editingTask = nil
            }
        }
        return true
    }

    private func configureCreateVM(_ vm: TaskEditViewModel, columns: [BoardColumn]) -> Bool {
        vm.availableColumns = columns.isEmpty ? listColumnsVM.listColumns : columns
        vm.onSave = { editVM in
            Task {
                if let item = await dataController.createTask(from: editVM) {
                    if settingsManager.settings.newTaskPosition == .top {
                        boardDetailVM.addTask(item)
                    } else {
                        boardDetailVM.addTaskAtEnd(item)
                    }
                    syncState()
                }
                showCreateTask = false
            }
        }
        return true
    }

    // MARK: - Share board sheet

    private var shareBoardSheet: some View {
        NavigationStack {
            VStack(spacing: 20) {
                if let boardId = boardListVM.selectedBoardId {
                    let sharePayload = dataController.boardShareEnvelope(boardId: boardId) ?? boardId
                    let relayText = dataController.boardRelayHints(boardId: boardId)
                    Image(systemName: "square.and.arrow.up.circle.fill")
                        .font(.system(size: 48))
                        .foregroundStyle(.blue)

                    Text("Share Board")
                        .font(.title3.bold())
                    Text("Share this payload with others to let them join the same board and relay set:")
                        .font(.subheadline).foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)

                    VStack(spacing: 8) {
                        Text(sharePayload)
                            .font(.system(.caption, design: .monospaced))
                            .lineLimit(6)
                            .multilineTextAlignment(.center)

                        Button(action: {
                            PlatformServices.copyToPasteboard(sharePayload)
                            PlatformServices.notificationSuccess()
                        }) {
                            Label("Copy Share Payload", systemImage: "doc.on.doc")
                                .font(.subheadline)
                        }
                        .buttonStyle(.bordered)

                        ShareLink(item: sharePayload) {
                            Label("Share", systemImage: "square.and.arrow.up")
                                .font(.subheadline)
                        }
                        .buttonStyle(.borderedProminent)
                    }
                    .padding()
                    .background(Color.secondary.opacity(0.06))
                    .clipShape(RoundedRectangle(cornerRadius: 12))

                    Text("Board ID: \(boardId)")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                        .textSelection(.enabled)

                    Text("Relays: \((relayText.isEmpty ? shellVM.profile.relays : relayText).joined(separator: ", "))")
                        .font(.caption2).foregroundStyle(.tertiary)
                        .multilineTextAlignment(.center)
                } else {
                    Text("No board selected").foregroundStyle(.secondary)
                }
            }
            .padding(24)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { showShareSheet = false }
                }
            }
        }
    }

    // MARK: - Filter/Sort sheet

    @ViewBuilder
    private func filterSortSheet() -> some View {
        let clearCompletedAvailable = boardListVM.selectedBoardId
            .flatMap { dataController.boardSettings(boardId: $0)?.clearCompletedDisabled }
            .map { !$0 } ?? true
        FilterSortSheet(
            detailVM: boardDetailVM,
            lastClearCount: $lastClearCompletedCount,
            clearCompletedAvailable: clearCompletedAvailable,
            onApplySort: { mode, ascending in
                boardDetailVM.applySort(mode: mode, ascending: ascending)
                if let boardId = boardListVM.selectedBoardId {
                    Task {
                        await dataController.updateBoardSort(boardId: boardId, sortMode: mode, ascending: ascending)
                    }
                }
                syncState()
            },
            onClear: {
                lastClearCompletedCount = boardDetailVM.clearCompletedForSelectedBoard()
                syncState()
            },
            onDismiss: { showFilterSortSheet = false }
        )
    }

    // MARK: - Manage Board Sheet

    @ViewBuilder
    private var manageBoardSheet: some View {
        if let boardId = boardListVM.selectedBoardId {
            let settings = dataController.boardSettings(boardId: boardId)
                ?? BoardSettingsSnapshot(
                    id: boardId,
                    name: selectedBoardName,
                    kind: dataController.boardKind(boardId: boardId) ?? "lists",
                    columns: {
                        let stored = dataController.boardColumns(boardId: boardId)
                        return stored.isEmpty ? listColumnsVM.listColumns : stored
                    }()
                )
            ManageBoardView(
                settings: settings,
                availableCompoundBoards: dataController.availableCompoundBoards(excluding: boardId)
            )
        }
    }

    // MARK: - Bootstrap

    private var selectedBoardName: String {
        guard let selectedId = boardListVM.selectedBoardId else { return "Board" }
        return dataController.boardDefinition(boardId: selectedId)?.name
            ?? boardListVM.visibleBoards.first(where: { $0.id == selectedId })?.name
            ?? "Board"
    }

    private var selectedBoardKind: String? {
        guard let selectedId = boardListVM.selectedBoardId else { return nil }
        return dataController.boardKind(boardId: selectedId)
    }

    private func bootstrapBoards() {
        boardListVM.setBoards(availableNavigationBoards, preferredBoardId: preferredStartupBoardId)
        boardDetailVM.setSelectedBoard(id: boardListVM.selectedBoardId)
        headerVM.bind(mode: boardModeVM.mode)
        headerVM.setActionHandlers(
            onFilterSort: { showFilterSortSheet = true },
            onShareBoard: { showShareSheet = true },
            onClearCompleted: {
                lastClearCompletedCount = boardDetailVM.clearCompletedForSelectedBoard()
                syncState()
            }
        )

        // Load stored sort preferences
        if let boardId = boardListVM.selectedBoardId {
            let prefs = dataController.boardSortPreferences(boardId: boardId)
            boardDetailVM.applySort(mode: prefs.mode, ascending: prefs.ascending)
        }

        Task { await loadBoardTasks(boardId: boardListVM.selectedBoardId) }
    }

    private func loadBoardTasks(boardId: String?) async {
        guard let boardId else {
            boardDetailVM.setSelectedBoard(id: nil)
            return
        }
        boardDetailVM.setSelectedBoard(id: boardId)
        boardDetailVM.setLoading()

        // Load sort preferences
        let prefs = dataController.boardSortPreferences(boardId: boardId)
        boardDetailVM.applySort(mode: prefs.mode, ascending: prefs.ascending)

        // Subscribe and get local-first tasks
        let tasks = await dataController.subscribeToBoard(boardId)
        boardDetailVM.setTasks(for: boardId, tasks: tasks)
        syncState()
    }

    private func syncState() {
        syncListColumnsState()
        seedBoardModeState()
    }

    private func syncListColumnsState() {
        guard let selected = boardListVM.visibleBoards.first(where: { $0.id == boardListVM.selectedBoardId }) else { return }
        let definitions = dataController.relatedBoardDefinitions(for: selected.id)
        let current = definitions.first(where: { $0.id == selected.id })
            ?? ListBoardDefinition(
                id: selected.id,
                name: selected.name,
                kind: .lists,
                columns: dataController.boardColumns(boardId: selected.id)
            )
        let fallbackColumns = current.columns.isEmpty
            ? BoardColumnDerivation.deriveColumns(from: boardDetailVM.visibleTasks)
            : current.columns
        let resolvedCurrent = current.columns.isEmpty
            ? ListBoardDefinition(
                id: current.id,
                name: current.name,
                kind: current.kind,
                columns: fallbackColumns,
                children: current.children,
                hideChildBoardNames: current.hideChildBoardNames
            )
            : current
        let allDefinitions = definitions.isEmpty ? [resolvedCurrent] : definitions
        listColumnsVM.configure(currentBoard: resolvedCurrent, boards: allDefinitions)
        listColumnsVM.setTasks(boardDetailVM.visibleTasks.map {
            .init(
                id: $0.id,
                boardId: $0.boardId ?? resolvedCurrent.id,
                columnId: $0.columnId ?? fallbackColumns.first?.id ?? "todo",
                title: $0.title,
                completed: $0.completed
            )
        })
    }

    private func seedBoardModeState() {
        let boardItems = settingsManager.settings.completedTab
            ? boardDetailVM.visibleTasks.filter { !$0.completed }.map(\.id)
            : boardDetailVM.visibleTasks.map(\.id)
        boardModeVM.setBoardItems(boardItems)
        boardModeVM.setUpcomingItems(boardDetailVM.upcomingTasks().map(\.id))
        boardModeVM.setCompletedItems(boardDetailVM.visibleTasks.filter(\.completed).map(\.id))
    }
}

// MARK: - Interactive Board Mode Pane

struct InteractiveBoardModePane: View {
    @ObservedObject var modeVM: BoardModeViewModel
    @ObservedObject var detailVM: BoardDetailViewModel
    @ObservedObject var listColumnsVM: ListColumnsViewModel
    var usesColumnLayout: Bool = true
    var showsIndexLane: Bool = false
    var usesWeekLayout: Bool = false
    var weekStart: Int = 0
    var allowsInlineTaskEntry: Bool = false
    var allowsListCreation: Bool = false
    var hideCompletedSubtasks: Bool = false
    var showsStreaks: Bool = true
    var showsCompletedTasksInBoard: Bool = false
    var onToggleComplete: (String) -> Void
    var onTapTask: (BoardTaskItem) -> Void
    var onToggleSubtask: (String, String) -> Void
    var onInlineAddTask: (String, String) -> Void
    var onAddList: (String) -> Void
    var onRefresh: (() async -> Void)? = nil

    var body: some View {
        Group {
            switch modeVM.currentState {
            case .loading(let text):
                ProgressView(text)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            case .error(let message):
                VStack(spacing: 10) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.title2).foregroundStyle(.orange)
                    Text(message).font(.subheadline)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            case .empty(let message):
                VStack(spacing: 10) {
                    Image(systemName: "checklist").font(.title2).foregroundStyle(.secondary)
                    Text(message).font(.subheadline).foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            case .ready:
                switch modeVM.mode {
                case .board:
                    if usesColumnLayout {
                        InteractiveBoardColumnsPane(
                            columnsVM: listColumnsVM,
                            detailVM: detailVM,
                            showsIndexLane: showsIndexLane,
                            allowsInlineTaskEntry: allowsInlineTaskEntry,
                            allowsListCreation: allowsListCreation,
                            hideCompletedSubtasks: hideCompletedSubtasks,
                            showsStreaks: showsStreaks,
                            showsCompletedTasksInBoard: showsCompletedTasksInBoard,
                            onToggleComplete: onToggleComplete,
                            onTapTask: onTapTask,
                            onToggleSubtask: onToggleSubtask,
                            onInlineAddTask: onInlineAddTask,
                            onAddList: onAddList,
                            onRefresh: onRefresh
                        )
                    } else if usesWeekLayout {
                        InteractiveWeekBoardPane(
                            detailVM: detailVM,
                            weekStart: weekStart,
                            hideCompletedSubtasks: hideCompletedSubtasks,
                            showsStreaks: showsStreaks,
                            showsCompletedTasksInBoard: showsCompletedTasksInBoard,
                            onToggleComplete: onToggleComplete,
                            onTapTask: onTapTask,
                            onToggleSubtask: onToggleSubtask,
                            onInlineAddTask: onInlineAddTask,
                            onRefresh: onRefresh
                        )
                    } else {
                        taskList(
                            showsCompletedTasksInBoard
                                ? detailVM.visibleTasks
                                : detailVM.visibleTasks.filter { !$0.completed },
                            emptyIcon: "checklist",
                            emptyText: detailVM.emptyMessage
                        )
                    }
                case .boardUpcoming:
                    taskList(detailVM.upcomingTasks(), emptyIcon: "calendar", emptyText: "No upcoming tasks")
                case .completed:
                    taskList(detailVM.visibleTasks.filter(\.completed), emptyIcon: "checkmark.circle", emptyText: "No completed tasks")
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    @ViewBuilder
    private func taskList(_ tasks: [BoardTaskItem], emptyIcon: String, emptyText: String) -> some View {
        if tasks.isEmpty {
            VStack(spacing: 10) {
                Image(systemName: emptyIcon)
                    .font(.title2).foregroundStyle(.secondary)
                Text(emptyText)
                    .font(.subheadline).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ScrollView {
                LazyVStack(spacing: 1) {
                    ForEach(tasks) { task in
                        taskCard(task)
                        if task.id != tasks.last?.id {
                            Divider().padding(.leading, 48)
                        }
                    }
                }
                .padding(.top, 8)
            }
            .refreshable {
                await onRefresh?()
            }
        }
    }

    @ViewBuilder
    private func taskCard(_ task: BoardTaskItem) -> some View {
        TaskCardView(
            task: task, priority: task.priority, subtasksJSON: task.subtasksJSON,
            dueTimeEnabled: task.dueTimeEnabled ?? false,
            streak: showsStreaks ? task.streak : nil,
            hasRecurrence: task.recurrenceJSON != nil,
            hideCompletedSubtasks: hideCompletedSubtasks,
            onToggleComplete: { onToggleComplete(task.id) },
            onTap: { onTapTask(task) },
            onToggleSubtask: { subId in onToggleSubtask(task.id, subId) }
        )
        .swipeActions(edge: .trailing) {
            Button(role: .destructive) { onToggleComplete(task.id) } label: {
                Label(task.completed ? "Reopen" : "Complete", systemImage: task.completed ? "arrow.uturn.backward" : "checkmark")
            }
        }
    }
}

// MARK: - Interactive Board Columns Pane

struct InteractiveBoardColumnsPane: View {
    @ObservedObject var columnsVM: ListColumnsViewModel
    @ObservedObject var detailVM: BoardDetailViewModel
    var showsIndexLane: Bool = false
    var allowsInlineTaskEntry: Bool = false
    var allowsListCreation: Bool = false
    var hideCompletedSubtasks: Bool = false
    var showsStreaks: Bool = true
    var showsCompletedTasksInBoard: Bool = false
    var onToggleComplete: (String) -> Void
    var onTapTask: (BoardTaskItem) -> Void
    var onToggleSubtask: (String, String) -> Void
    var onInlineAddTask: (String, String) -> Void
    var onAddList: (String) -> Void
    var onRefresh: (() async -> Void)? = nil
    @Environment(\.appAccent) private var accentChoice
    @State private var inlineTitles: [String: String] = [:]
    @State private var pendingListName = ""
    @State private var selectedIndexColumnId: String?
    @FocusState private var focusedColumnId: String?
    @FocusState private var addListFocused: Bool

    private var indexEntryIDs: [String] {
        columnsVM.indexSections.flatMap { $0.entries.map(\.id) }
    }

    var body: some View {
        Group {
            if columnsVM.listColumns.isEmpty && !allowsListCreation {
                VStack(spacing: 10) {
                    Image(systemName: "square.split.2x2")
                        .font(.title2)
                        .foregroundStyle(.secondary)
                    Text("No lists available for this board.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollViewReader { scrollProxy in
                    ScrollView(.horizontal) {
                        HStack(alignment: .top, spacing: 12) {
                            if showsIndexLane {
                                indexLane(scrollProxy: scrollProxy)
                            }

                            ForEach(columnsVM.listColumns) { column in
                                columnView(column)
                                    .id(column.id)
                            }

                            if allowsListCreation {
                                addListLane
                            }
                        }
                        .padding(.horizontal, 8)
                        .padding(.vertical, 8)
                    }
                    .refreshable {
                        await onRefresh?()
                    }
                    .onAppear {
                        syncSelectedIndexColumn()
                    }
                    .onChange(of: indexEntryIDs) { _, _ in
                        syncSelectedIndexColumn()
                    }
                }
            }
        }
    }

    private func indexLane(scrollProxy: ScrollViewProxy) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Index")
                .font(.subheadline.bold())

            if columnsVM.indexSections.isEmpty {
                Text("No lists yet.")
                    .font(.footnote)
                    .foregroundStyle(.tertiary)
                    .padding(.vertical, 8)
            } else {
                VStack(alignment: .leading, spacing: 12) {
                    ForEach(columnsVM.indexSections) { section in
                        indexSection(section, scrollProxy: scrollProxy)
                    }
                }
            }

            Spacer(minLength: 0)
        }
        .padding(14)
        .frame(width: 220, alignment: .topLeading)
        .background(Color.secondary.opacity(0.04))
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .frame(maxHeight: .infinity, alignment: .top)
    }

    @ViewBuilder
    private func indexSection(_ section: ListColumnIndexSection, scrollProxy: ScrollViewProxy) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if let title = section.title, !title.isEmpty {
                Text(title)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .textCase(.uppercase)
            }

            ForEach(section.entries) { entry in
                let active = selectedIndexColumnId == entry.id

                Button(action: { focusColumn(entry.id, scrollProxy: scrollProxy) }) {
                    HStack(spacing: 10) {
                        Text(entry.label)
                            .font(.footnote.weight(.medium))
                            .lineLimit(1)
                            .foregroundStyle(active ? .primary : .secondary)

                        Spacer(minLength: 0)

                        if let ordinal = indexOrdinal(for: entry.id) {
                            Text("\(ordinal)")
                                .font(.caption2.monospacedDigit())
                                .foregroundStyle(active ? ThemeColors.accent(for: accentChoice) : Color.secondary)
                        }
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 9)
                    .background(
                        RoundedRectangle(cornerRadius: 10)
                            .fill(active ? ThemeColors.accent(for: accentChoice).opacity(0.16) : ThemeColors.surfaceBase)
                    )
                }
                .buttonStyle(.plain)
            }
        }
    }

    @ViewBuilder
    private func columnView(_ column: BoardColumn) -> some View {
        let colTaskIds = Set((columnsVM.itemsByColumn[column.id] ?? []).map(\.id))
        let allColumnTasks = detailVM.visibleTasks.filter { colTaskIds.contains($0.id) }
        let colTasks = showsCompletedTasksInBoard ? allColumnTasks : allColumnTasks.filter { !$0.completed }
        let completedCount = showsCompletedTasksInBoard ? 0 : allColumnTasks.filter(\.completed).count

        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(column.name)
                    .font(.subheadline.bold())
                Text("\(colTasks.count)")
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 6).padding(.vertical, 2)
                    .background(Color.secondary.opacity(0.12))
                    .clipShape(Capsule())
            }
            Divider()

            if colTasks.isEmpty {
                Text("No tasks")
                    .font(.footnote)
                    .foregroundStyle(.tertiary)
                    .padding(.vertical, 8)
            } else {
                ForEach(colTasks) { task in
                    TaskCardView(
                        task: task, priority: task.priority, subtasksJSON: task.subtasksJSON,
                        dueTimeEnabled: task.dueTimeEnabled ?? false,
                        streak: showsStreaks ? task.streak : nil,
                        hasRecurrence: task.recurrenceJSON != nil,
                        hideCompletedSubtasks: hideCompletedSubtasks,
                        onToggleComplete: { onToggleComplete(task.id) },
                        onTap: { onTapTask(task) },
                        onToggleSubtask: { subId in onToggleSubtask(task.id, subId) }
                    )
                    .background(ThemeColors.surfaceRaised)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                }
            }

            if allowsInlineTaskEntry {
                inlineTaskComposer(for: column)
                    .padding(.top, 6)
            } else if completedCount > 0 {
                Text("\(completedCount) completed")
                    .font(.footnote)
                    .foregroundStyle(.tertiary)
                    .padding(.top, 6)
            }
        }
        .padding(10)
        .frame(width: 280, alignment: .topLeading)
        .background(Color.secondary.opacity(0.04))
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .frame(maxHeight: .infinity, alignment: .top)
    }

    private func inlineTaskComposer(for column: BoardColumn) -> some View {
        HStack(spacing: 8) {
            TextField("New task", text: Binding(
                get: { inlineTitles[column.id] ?? "" },
                set: { inlineTitles[column.id] = $0 }
            ))
            .focused($focusedColumnId, equals: column.id)
            .textFieldStyle(.plain)
            .font(.footnote)
            .onSubmit {
                submitInlineTask(for: column.id)
            }

            Button(action: { submitInlineTask(for: column.id) }) {
                Image(systemName: "plus")
                    .font(.caption.bold())
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.small)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(ThemeColors.surfaceBase)
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }

    private var addListLane: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Add list")
                .font(.subheadline.bold())

            TextField("List name", text: $pendingListName)
                .focused($addListFocused)
                .textFieldStyle(.roundedBorder)
                .onSubmit { submitList() }

            Button(action: submitList) {
                Label("Create List", systemImage: "plus")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)

            Text("Create a new lane and start dropping tasks into it.")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            Spacer(minLength: 0)
        }
        .padding(14)
        .frame(width: 240, alignment: .topLeading)
        .background(Color.secondary.opacity(0.04))
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .frame(maxHeight: .infinity, alignment: .top)
    }

    private func submitInlineTask(for columnId: String) {
        let trimmed = (inlineTitles[columnId] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        inlineTitles[columnId] = ""
        onInlineAddTask(columnId, trimmed)
    }

    private func submitList() {
        let trimmed = pendingListName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        pendingListName = ""
        onAddList(trimmed)
    }

    private func syncSelectedIndexColumn() {
        guard showsIndexLane else {
            selectedIndexColumnId = nil
            return
        }

        guard let selectedIndexColumnId, indexEntryIDs.contains(selectedIndexColumnId) else {
            selectedIndexColumnId = indexEntryIDs.first
            return
        }
    }

    private func focusColumn(_ columnId: String, scrollProxy: ScrollViewProxy) {
        guard indexEntryIDs.contains(columnId) else { return }
        selectedIndexColumnId = columnId
        withAnimation(.easeInOut(duration: 0.2)) {
            scrollProxy.scrollTo(columnId, anchor: .leading)
        }
    }

    private func indexOrdinal(for columnId: String) -> Int? {
        indexEntryIDs.firstIndex(of: columnId).map { $0 + 1 }
    }
}

struct InteractiveWeekBoardPane: View {
    @ObservedObject var detailVM: BoardDetailViewModel
    @Environment(\.appAccent) private var accentChoice
    var weekStart: Int = 0
    var hideCompletedSubtasks: Bool = false
    var showsStreaks: Bool = true
    var showsCompletedTasksInBoard: Bool = false
    var onToggleComplete: (String) -> Void
    var onTapTask: (BoardTaskItem) -> Void
    var onToggleSubtask: (String, String) -> Void
    var onInlineAddTask: (String, String) -> Void
    var onRefresh: (() async -> Void)? = nil

    @State private var inlineTitles: [Int: String] = [:]
    @FocusState private var focusedWeekday: Int?

    private var days: [WeekBoardDay] {
        detailVM.weekBoardDays(
            weekStart: weekStart,
            includeCompleted: showsCompletedTasksInBoard
        )
    }

    var body: some View {
        ScrollView(.horizontal) {
            HStack(alignment: .top, spacing: 12) {
                ForEach(days) { day in
                    dayView(day)
                }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 8)
        }
        .refreshable {
            await onRefresh?()
        }
    }

    @ViewBuilder
    private func dayView(_ day: WeekBoardDay) -> some View {
        let completedCount = showsCompletedTasksInBoard ? 0 : day.tasks.filter(\.completed).count
        let cardTasks = showsCompletedTasksInBoard ? day.tasks : day.tasks.filter { !$0.completed }

        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(day.label)
                    .font(.subheadline.bold())

                if day.isToday {
                    Text("Today")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 3)
                        .background(ThemeColors.accent(for: accentChoice))
                        .clipShape(Capsule())
                }

                Spacer(minLength: 0)

                Text("\(cardTasks.count)")
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(Color.secondary.opacity(0.12))
                    .clipShape(Capsule())
            }

            Divider()

            if cardTasks.isEmpty {
                Text("No tasks")
                    .font(.footnote)
                    .foregroundStyle(.tertiary)
                    .padding(.vertical, 8)
            } else {
                ForEach(cardTasks) { task in
                    TaskCardView(
                        task: task,
                        priority: task.priority,
                        subtasksJSON: task.subtasksJSON,
                        dueTimeEnabled: task.dueTimeEnabled ?? false,
                        streak: showsStreaks ? task.streak : nil,
                        hasRecurrence: task.recurrenceJSON != nil,
                        hideCompletedSubtasks: hideCompletedSubtasks,
                        onToggleComplete: { onToggleComplete(task.id) },
                        onTap: { onTapTask(task) },
                        onToggleSubtask: { subId in onToggleSubtask(task.id, subId) }
                    )
                    .background(ThemeColors.surfaceRaised)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                }
            }

            inlineTaskComposer(for: day)

            if completedCount > 0 {
                Text("\(completedCount) completed")
                    .font(.footnote)
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(10)
        .frame(width: 280, alignment: .topLeading)
        .background(Color.secondary.opacity(day.isToday ? 0.08 : 0.04))
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .frame(maxHeight: .infinity, alignment: .top)
    }

    private func inlineTaskComposer(for day: WeekBoardDay) -> some View {
        HStack(spacing: 8) {
            TextField("New task", text: Binding(
                get: { inlineTitles[day.weekday] ?? "" },
                set: { inlineTitles[day.weekday] = $0 }
            ))
            .focused($focusedWeekday, equals: day.weekday)
            .textFieldStyle(.plain)
            .font(.footnote)
            .onSubmit {
                submitInlineTask(for: day.weekday)
            }

            Button(action: { submitInlineTask(for: day.weekday) }) {
                Image(systemName: "plus")
                    .font(.caption.bold())
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.small)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(ThemeColors.surfaceBase)
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }

    private func submitInlineTask(for weekday: Int) {
        let trimmed = (inlineTitles[weekday] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        inlineTitles[weekday] = ""
        onInlineAddTask(String(weekday), trimmed)
    }
}

struct BoardHeaderIconButton: View {
    let systemName: String
    var isActive: Bool = false
    var isEnabled: Bool = true
    var accessibilityLabel: String
    var action: () -> Void
    @Environment(\.appAccent) private var accentChoice

    var body: some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(isActive ? ThemeColors.accent(for: accentChoice) : .primary)
                .frame(width: 36, height: 36)
                .background(
                    RoundedRectangle(cornerRadius: 10)
                        .fill(isActive ? ThemeColors.accent(for: accentChoice).opacity(0.16) : Color.secondary.opacity(0.08))
                )
        }
        .buttonStyle(.plain)
        .disabled(!isEnabled)
        .opacity(isEnabled ? 1 : 0.45)
        .accessibilityLabel(accessibilityLabel)
    }
}

// MARK: - Filter/Sort Sheet

struct FilterSortSheet: View {
    @ObservedObject var detailVM: BoardDetailViewModel
    @Binding var lastClearCount: Int
    var clearCompletedAvailable: Bool = true
    var onApplySort: (TaskSortMode, Bool) -> Void
    var onClear: () -> Void
    var onDismiss: () -> Void

    @State private var sortMode: TaskSortMode = .manual
    @State private var sortAscending: Bool = true

    var body: some View {
        NavigationStack {
            List {
                Section("Sort By") {
                    ForEach([TaskSortMode.manual, .dueDate, .priority, .createdAt, .alphabetical], id: \.self) { mode in
                        Button(action: {
                            sortMode = mode
                            onApplySort(mode, sortAscending)
                        }) {
                            HStack {
                                Image(systemName: sortIcon(mode))
                                    .foregroundStyle(.secondary)
                                    .frame(width: 24)
                                Text(sortLabel(mode))
                                Spacer()
                                if sortMode == mode {
                                    Image(systemName: "checkmark")
                                        .foregroundStyle(.blue)
                                }
                            }
                        }
                        .tint(.primary)
                    }

                    Toggle("Ascending", isOn: Binding(
                        get: { sortAscending },
                        set: { newValue in
                            sortAscending = newValue
                            onApplySort(sortMode, newValue)
                        }
                    ))
                }

                if clearCompletedAvailable {
                    Section("Actions") {
                        let completedCount = detailVM.visibleTasks.filter(\.completed).count
                        Button(action: onClear) {
                            Label("Clear \(completedCount) completed", systemImage: "trash")
                        }
                        .disabled(completedCount == 0)
                    }
                } else {
                    Section {
                        Text("Clear completed is hidden for this board.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }

                if lastClearCount > 0 {
                    Section {
                        Text("Last clear removed \(lastClearCount) item(s).")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                }
            }
            .navigationTitle("Filter & Sort")
            .platformInlineTitle()
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { onDismiss() }
                }
            }
            .onAppear {
                sortMode = detailVM.sortMode
                sortAscending = detailVM.sortAscending
            }
        }
    }

    private func sortLabel(_ mode: TaskSortMode) -> String {
        switch mode {
        case .manual: return "Manual"
        case .dueDate: return "Due Date"
        case .priority: return "Priority"
        case .createdAt: return "Created"
        case .alphabetical: return "Alphabetical"
        }
    }

    private func sortIcon(_ mode: TaskSortMode) -> String {
        switch mode {
        case .manual: return "hand.draw"
        case .dueDate: return "calendar"
        case .priority: return "exclamationmark.triangle"
        case .createdAt: return "clock"
        case .alphabetical: return "textformat.abc"
        }
    }
}

// MARK: - Create Board Sheet

struct CreateBoardSheet: View {
    @EnvironmentObject private var dataController: DataController
    @Environment(\.dismiss) private var dismiss
    var onCreated: (() -> Void)? = nil

    @State private var boardName = ""
    @State private var boardKind = "lists"
    @State private var joinMode = false
    @State private var joinBoardId = ""
    @State private var relayCSV = ""

    private var parsedJoinPayload: BoardSharePayload? {
        BoardShareContract.parse(joinBoardId)
    }

    private var relayList: [String] {
        relayCSV
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }

    var body: some View {
        NavigationStack {
            Form {
                Picker("", selection: $joinMode) {
                    Text("Create").tag(false)
                    Text("Join").tag(true)
                }
                .pickerStyle(.segmented)
                .listRowBackground(Color.clear)

                if joinMode {
                    Section("Join an Existing Board") {
                        TextField("Board ID", text: $joinBoardId)
                            .platformNoAutoCaps()
                        TextField("Board Name (optional)", text: $boardName)
                        TextField("Relay override CSV (optional)", text: $relayCSV)
                            .platformNoAutoCaps()
                    }
                    Section {
                        Text("Paste a Taskify board share payload or raw board ID. Relay overrides are optional.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                } else {
                    Section("Create a New Board") {
                        TextField("Board Name", text: $boardName)
                        Picker("Type", selection: $boardKind) {
                            Text("Lists (Kanban)").tag("lists")
                            Text("Week").tag("week")
                            Text("Compound").tag("compound")
                        }
                        TextField("Relay CSV (optional)", text: $relayCSV)
                            .platformNoAutoCaps()
                    }
                    Section {
                        Text("Lists boards have customizable columns. Week boards use day columns. Compound boards collect child list boards.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            .navigationTitle(joinMode ? "Join Board" : "New Board")
            .platformInlineTitle()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(joinMode ? "Join" : "Create") {
                        Task {
                            if joinMode {
                                let fallbackBoardId = joinBoardId.trimmingCharacters(in: .whitespacesAndNewlines)
                                let payload = parsedJoinPayload ?? BoardSharePayload(
                                    boardId: fallbackBoardId,
                                    boardName: boardName.isEmpty ? nil : boardName,
                                    relays: relayList
                                )
                                let resolvedName = boardName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                                    ? (payload.boardName ?? "Shared Board")
                                    : boardName.trimmingCharacters(in: .whitespacesAndNewlines)
                                let resolvedRelays = relayList.isEmpty ? payload.relays : relayList
                                let _ = await dataController.joinBoard(
                                    boardId: payload.boardId,
                                    name: resolvedName,
                                    relays: resolvedRelays
                                )
                            } else {
                                let name = boardName.trimmingCharacters(in: .whitespaces)
                                guard !name.isEmpty else { return }
                                let columns: [BoardColumn]
                                if boardKind == "week" {
                                    columns = [
                                        BoardColumn(id: "sun", name: "Sunday"),
                                        BoardColumn(id: "mon", name: "Monday"),
                                        BoardColumn(id: "tue", name: "Tuesday"),
                                        BoardColumn(id: "wed", name: "Wednesday"),
                                        BoardColumn(id: "thu", name: "Thursday"),
                                        BoardColumn(id: "fri", name: "Friday"),
                                        BoardColumn(id: "sat", name: "Saturday"),
                                    ]
                                } else if boardKind == "compound" {
                                    columns = []
                                } else {
                                    columns = [
                                        BoardColumn(id: "todo", name: "To Do"),
                                        BoardColumn(id: "doing", name: "Doing"),
                                        BoardColumn(id: "done", name: "Done"),
                                    ]
                                }
                                let _ = await dataController.createBoard(
                                    name: name,
                                    kind: boardKind,
                                    columns: columns,
                                    relayHints: relayList
                                )
                            }
                            onCreated?()
                            dismiss()
                        }
                    }
                    .bold()
                    .disabled(joinMode ? joinBoardId.trimmingCharacters(in: .whitespaces).isEmpty : boardName.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
    }
}
