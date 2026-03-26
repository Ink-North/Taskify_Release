import SwiftUI
import TaskifyCore

struct BoardsShellScreen: View {
    @ObservedObject var shellVM: AppShellViewModel
    @EnvironmentObject private var dataController: DataController
    @StateObject private var boardListVM = BoardListViewModel()
    @StateObject private var boardDetailVM = BoardDetailViewModel()
    @StateObject private var boardModeVM = BoardModeViewModel()
    @StateObject private var headerVM = BoardHeaderControlsViewModel(completedTabEnabled: true, canShareBoard: true)
    @StateObject private var listColumnsVM = ListColumnsViewModel()

    @State private var showShareSheet = false
    @State private var showFilterSortSheet = false
    @State private var showCreateBoard = false
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
            .sheet(item: $editingTask) { task in taskEditSheet(for: task) }
            .sheet(isPresented: $showCreateTask) { taskCreateSheet() }
            .sheet(isPresented: $showCreateBoard) { CreateBoardSheet() }
            .sheet(isPresented: $showShareSheet) { shareBoardSheet }
            .sheet(isPresented: $showFilterSortSheet) { filterSortSheet() }
        }
    }

    // MARK: - Empty boards

    private var emptyBoardsView: some View {
        VStack(spacing: 16) {
            Image(systemName: "tray")
                .font(.largeTitle).foregroundStyle(.secondary)
            Text("No boards yet")
                .font(.title3.bold())
            Text("Create a new board or join an existing one to get started.")
                .font(.subheadline).foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button(action: { showCreateBoard = true }) {
                Label("Create Board", systemImage: "plus.circle.fill")
            }
            .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(24)
    }

    // MARK: - Main board content

    private var boardContentView: some View {
        VStack(spacing: 0) {
            // Header: board picker + add
            VStack(spacing: 10) {
                HStack {
                    Picker("Boards", selection: Binding(
                        get: { boardListVM.selectedBoardId ?? "" },
                        set: { boardListVM.selectBoard(id: $0) }
                    )) {
                        ForEach(boardListVM.visibleBoards, id: \.id) { board in
                            Text(board.name).tag(board.id)
                        }
                    }
                    .pickerStyle(.menu)

                    Spacer()

                    // Sync indicator
                    if dataController.syncing {
                        ProgressView()
                            .scaleEffect(0.7)
                    } else if dataController.relayConnected > 0 {
                        Image(systemName: "antenna.radiowaves.left.and.right")
                            .font(.caption)
                            .foregroundStyle(.green)
                    }

                    Button(action: { showCreateTask = true }) {
                        Image(systemName: "plus.circle.fill")
                            .font(.title2)
                    }
                }

                Picker("Mode", selection: Binding(
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

                // Quick add bar
                HStack(spacing: 8) {
                    Image(systemName: "plus").foregroundStyle(.secondary).font(.subheadline)
                    TextField("Quick add task…", text: $quickAddTitle)
                        .focused($quickAddFocused)
                        .onSubmit { Task { await quickAddTask() } }
                        .textFieldStyle(.plain)
                        .font(.subheadline)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(Color.secondary.opacity(0.08))
                .clipShape(RoundedRectangle(cornerRadius: 10))
            }
            .padding(.horizontal, 12)
            .padding(.top, 8)

            // Task list
            InteractiveBoardModePane(
                modeVM: boardModeVM,
                detailVM: boardDetailVM,
                listColumnsVM: listColumnsVM,
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
                }
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    // MARK: - Toolbar

    @ToolbarContentBuilder
    private var toolbarItems: some ToolbarContent {
        ToolbarItemGroup(placement: .topBarTrailing) {
            if boardListVM.state == .ready {
                Button(action: { showFilterSortSheet = true }) {
                    Image(systemName: "line.3.horizontal.decrease.circle")
                }
                Button(action: { showCreateBoard = true }) {
                    Image(systemName: "folder.badge.plus")
                }
                if headerVM.canShareBoard {
                    Button(action: { showShareSheet = true }) {
                        Image(systemName: "square.and.arrow.up")
                    }
                }
            }
        }
    }

    // MARK: - Quick add

    private func quickAddTask() async {
        let trimmed = quickAddTitle.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty, let boardId = boardListVM.selectedBoardId else { return }
        let defaultCol = listColumnsVM.listColumns.first?.id
        if let item = await dataController.quickAddTask(title: trimmed, boardId: boardId, columnId: defaultCol) {
            boardDetailVM.addTask(item)
            syncState()
        }
        quickAddTitle = ""
    }

    // MARK: - Edit sheets

    @ViewBuilder
    private func taskEditSheet(for task: BoardTaskItem) -> some View {
        let loc = TaskLocation(
            boardId: task.boardId ?? boardListVM.selectedBoardId ?? "",
            boardName: task.boardName ?? "",
            columnId: task.columnId
        )
        let vm = TaskEditViewModel.forEdit(task: task, location: loc)
        let _ = configureEditVM(vm, task: task)
        TaskEditView(viewModel: vm)
    }

    @ViewBuilder
    private func taskCreateSheet() -> some View {
        let boardId = boardListVM.selectedBoardId ?? ""
        let boardName = boardListVM.visibleBoards.first(where: { $0.id == boardId })?.name ?? ""
        let defaultCol = listColumnsVM.listColumns.first?.id
        let loc = TaskLocation(boardId: boardId, boardName: boardName, columnId: defaultCol)
        let vm = TaskEditViewModel.forCreate(location: loc)
        let _ = configureCreateVM(vm)
        TaskEditView(viewModel: vm)
    }

    private func configureEditVM(_ vm: TaskEditViewModel, task: BoardTaskItem) -> Bool {
        vm.availableColumns = listColumnsVM.listColumns
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

    private func configureCreateVM(_ vm: TaskEditViewModel) -> Bool {
        vm.availableColumns = listColumnsVM.listColumns
        vm.onSave = { editVM in
            Task {
                if let item = await dataController.createTask(from: editVM) {
                    boardDetailVM.addTask(item)
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
            VStack(spacing: 16) {
                if let boardId = boardListVM.selectedBoardId {
                    Text("Share Board").font(.headline)
                    Text("Share this ID with others to let them join your board:")
                        .font(.subheadline).foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)

                    // Board ID display
                    HStack {
                        Text(boardId)
                            .font(.system(.caption, design: .monospaced))
                            .lineLimit(1)
                            .truncationMode(.middle)
                        Button(action: {
                            UIPasteboard.general.string = boardId
                        }) {
                            Image(systemName: "doc.on.doc")
                        }
                    }
                    .padding()
                    .background(Color.secondary.opacity(0.08))
                    .clipShape(RoundedRectangle(cornerRadius: 10))

                    Text("Relays: \(shellVM.profile.relays.joined(separator: ", "))")
                        .font(.caption2).foregroundStyle(.secondary)
                } else {
                    Text("No board selected").foregroundStyle(.secondary)
                }
            }
            .padding(20)
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
        FilterSortSheet(
            detailVM: boardDetailVM,
            lastClearCount: $lastClearCompletedCount,
            onClear: {
                lastClearCompletedCount = boardDetailVM.clearCompletedForSelectedBoard()
                syncState()
            },
            onDismiss: { showFilterSortSheet = false }
        )
    }

    // MARK: - Bootstrap

    private func bootstrapBoards() {
        boardListVM.setBoards(shellVM.profile.boards)
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
        Task { await loadBoardTasks(boardId: boardListVM.selectedBoardId) }
    }

    private func loadBoardTasks(boardId: String?) async {
        guard let boardId else { return }
        boardDetailVM.setSelectedBoard(id: boardId)
        boardDetailVM.setLoading()

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
        let definition = ListBoardDefinition(
            id: selected.id, name: selected.name, kind: .lists,
            columns: BoardColumnDerivation.deriveColumns(from: boardDetailVM.visibleTasks)
        )
        listColumnsVM.configure(currentBoard: definition, boards: [definition])
        listColumnsVM.setTasks(boardDetailVM.visibleTasks.map {
            .init(id: $0.id, boardId: definition.id, columnId: $0.columnId ?? "todo", title: $0.title, completed: $0.completed)
        })
    }

    private func seedBoardModeState() {
        boardModeVM.setBoardItems(boardDetailVM.visibleTasks.map(\.id))
        boardModeVM.setUpcomingItems(boardDetailVM.upcomingTasks().map(\.id))
        boardModeVM.setCompletedItems(boardDetailVM.visibleTasks.filter(\.completed).map(\.id))
    }
}

// MARK: - Interactive Board Mode Pane

struct InteractiveBoardModePane: View {
    @ObservedObject var modeVM: BoardModeViewModel
    @ObservedObject var detailVM: BoardDetailViewModel
    @ObservedObject var listColumnsVM: ListColumnsViewModel
    var onToggleComplete: (String) -> Void
    var onTapTask: (BoardTaskItem) -> Void
    var onToggleSubtask: (String, String) -> Void

    var body: some View {
        Group {
            switch modeVM.currentState {
            case .loading(let text):
                ProgressView(text)
            case .error(let message):
                VStack(spacing: 10) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.title2).foregroundStyle(.orange)
                    Text(message).font(.subheadline)
                }
            case .empty(let message):
                VStack(spacing: 10) {
                    Image(systemName: "checklist").font(.title2).foregroundStyle(.secondary)
                    Text(message).font(.subheadline).foregroundStyle(.secondary)
                }
            case .ready:
                switch modeVM.mode {
                case .board:
                    InteractiveBoardColumnsPane(columnsVM: listColumnsVM, detailVM: detailVM, onToggleComplete: onToggleComplete, onTapTask: onTapTask, onToggleSubtask: onToggleSubtask)
                case .boardUpcoming:
                    taskList(detailVM.upcomingTasks())
                case .completed:
                    taskList(detailVM.visibleTasks.filter(\.completed))
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    @ViewBuilder
    private func taskList(_ tasks: [BoardTaskItem]) -> some View {
        if tasks.isEmpty {
            VStack(spacing: 10) {
                Image(systemName: modeVM.mode == .completed ? "checkmark.circle" : "calendar")
                    .font(.title2).foregroundStyle(.secondary)
                Text(modeVM.mode == .completed ? "No completed tasks" : "No upcoming tasks")
                    .font(.subheadline).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ScrollView {
                LazyVStack(spacing: 1) {
                    ForEach(tasks) { task in
                        TaskCardView(
                            task: task, priority: task.priority, subtasksJSON: task.subtasksJSON,
                            dueTimeEnabled: task.dueTimeEnabled ?? false, streak: task.streak,
                            hasRecurrence: task.recurrenceJSON != nil,
                            onToggleComplete: { onToggleComplete(task.id) },
                            onTap: { onTapTask(task) },
                            onToggleSubtask: { subId in onToggleSubtask(task.id, subId) }
                        )
                        .swipeActions(edge: .trailing) {
                            Button(role: .destructive) { onToggleComplete(task.id) } label: {
                                Label(task.completed ? "Reopen" : "Complete", systemImage: task.completed ? "arrow.uturn.backward" : "checkmark")
                            }
                        }
                        Divider().padding(.leading, 48)
                    }
                }
            }
        }
    }
}

// MARK: - Interactive Board Columns Pane

struct InteractiveBoardColumnsPane: View {
    @ObservedObject var columnsVM: ListColumnsViewModel
    @ObservedObject var detailVM: BoardDetailViewModel
    var onToggleComplete: (String) -> Void
    var onTapTask: (BoardTaskItem) -> Void
    var onToggleSubtask: (String, String) -> Void

    var body: some View {
        ScrollView(.horizontal) {
            HStack(alignment: .top, spacing: 12) {
                ForEach(columnsVM.listColumns) { column in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text(column.name).font(.subheadline.bold())
                            let items = columnsVM.itemsByColumn[column.id] ?? []
                            Text("\(items.count)")
                                .font(.caption2).foregroundStyle(.secondary)
                                .padding(.horizontal, 6).padding(.vertical, 2)
                                .background(Color.secondary.opacity(0.12))
                                .clipShape(Capsule())
                        }
                        Divider()
                        let colTaskIds = Set((columnsVM.itemsByColumn[column.id] ?? []).map(\.id))
                        let colTasks = detailVM.visibleTasks.filter { colTaskIds.contains($0.id) }
                        if colTasks.isEmpty {
                            Text("No tasks").font(.footnote).foregroundStyle(.secondary).padding(.vertical, 8)
                        } else {
                            ForEach(colTasks) { task in
                                TaskCardView(
                                    task: task, priority: task.priority, subtasksJSON: task.subtasksJSON,
                                    dueTimeEnabled: task.dueTimeEnabled ?? false, streak: task.streak,
                                    hasRecurrence: task.recurrenceJSON != nil,
                                    onToggleComplete: { onToggleComplete(task.id) },
                                    onTap: { onTapTask(task) },
                                    onToggleSubtask: { subId in onToggleSubtask(task.id, subId) }
                                )
                            }
                        }
                    }
                    .padding(10)
                    .frame(width: 260, alignment: .topLeading)
                    .background(Color.secondary.opacity(0.06))
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                }
            }
            .padding(.horizontal, 4)
            .padding(.vertical, 4)
        }
    }
}

// MARK: - Filter/Sort Sheet

struct FilterSortSheet: View {
    @ObservedObject var detailVM: BoardDetailViewModel
    @Binding var lastClearCount: Int
    var onClear: () -> Void
    var onDismiss: () -> Void

    @State private var sortMode: TaskSortMode = .manual
    @State private var sortAscending: Bool = true

    var body: some View {
        NavigationStack {
            List {
                Section("Sort By") {
                    ForEach([TaskSortMode.manual, .dueDate, .priority, .createdAt, .alphabetical], id: \.self) { mode in
                        Button(action: { sortMode = mode }) {
                            HStack {
                                Text(sortLabel(mode))
                                Spacer()
                                if sortMode == mode {
                                    Image(systemName: "checkmark").foregroundStyle(.blue)
                                }
                            }
                        }
                        .tint(.primary)
                    }

                    Toggle("Ascending", isOn: $sortAscending)
                }

                Section("Actions") {
                    let completedCount = detailVM.visibleTasks.filter(\.completed).count
                    Button(action: onClear) {
                        Label("Clear \(completedCount) completed", systemImage: "trash")
                    }
                    .disabled(completedCount == 0)
                }

                if lastClearCount > 0 {
                    Section {
                        Text("Last clear removed \(lastClearCount) item(s).")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                }
            }
            .navigationTitle("Filter & Sort")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { onDismiss() }
                }
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
}

// MARK: - Create Board Sheet

struct CreateBoardSheet: View {
    @EnvironmentObject private var dataController: DataController
    @Environment(\.dismiss) private var dismiss

    @State private var boardName = ""
    @State private var boardKind = "lists"
    @State private var joinMode = false
    @State private var joinBoardId = ""

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
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                        TextField("Board Name (optional)", text: $boardName)
                    }
                    Section {
                        Text("Paste the board ID shared with you. The app will sync tasks from Nostr relays.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                } else {
                    Section("Create a New Board") {
                        TextField("Board Name", text: $boardName)
                        Picker("Type", selection: $boardKind) {
                            Text("Lists (Kanban)").tag("lists")
                            Text("Week").tag("week")
                        }
                    }
                }
            }
            .navigationTitle(joinMode ? "Join Board" : "New Board")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(joinMode ? "Join" : "Create") {
                        Task {
                            if joinMode {
                                let name = boardName.isEmpty ? "Shared Board" : boardName
                                let _ = await dataController.joinBoard(boardId: joinBoardId.trimmingCharacters(in: .whitespaces), name: name)
                            } else {
                                let name = boardName.trimmingCharacters(in: .whitespaces)
                                guard !name.isEmpty else { return }
                                let defaultColumns = [
                                    BoardColumn(id: "todo", name: "To Do"),
                                    BoardColumn(id: "doing", name: "Doing"),
                                    BoardColumn(id: "done", name: "Done"),
                                ]
                                let _ = await dataController.createBoard(name: name, kind: boardKind, columns: defaultColumns)
                            }
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

// MARK: - Legacy pane (kept for reference)

struct BoardDetailPane: View {
    @ObservedObject var viewModel: BoardDetailViewModel

    var body: some View {
        Group {
            switch viewModel.state {
            case .loading: ProgressView("Loading tasks…")
            case .empty:
                VStack(spacing: 10) {
                    Image(systemName: "checklist").font(.title2).foregroundStyle(.secondary)
                    Text(viewModel.emptyMessage).font(.subheadline).foregroundStyle(.secondary)
                }
            case .error(let message):
                VStack(spacing: 10) {
                    Image(systemName: "exclamationmark.triangle").font(.title2).foregroundStyle(.orange)
                    Text(message).font(.subheadline)
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
