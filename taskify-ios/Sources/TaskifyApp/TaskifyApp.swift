import SwiftUI
import SwiftData
import TaskifyCore

@main
struct TaskifyApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
        }
        .modelContainer(for: [
            TaskifyTask.self,
            TaskifyCalendarEvent.self,
            TaskifyBoard.self,
        ])
    }
}

struct RootView: View {
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \TaskifyBoard.name) private var boards: [TaskifyBoard]
    @StateObject private var vm = AppViewModel()

    var body: some View {
        NavigationSplitView {
            BoardListView(selectedBoardId: $vm.selectedBoardId) {
                vm.showingAddBoard = true
            }
            .navigationTitle("Taskify")
        } detail: {
            if let selected = selectedBoard {
                BoardDetailView(board: selected)
            } else {
                ContentUnavailableView("Select a board", systemImage: "sidebar.left")
            }
        }
        .task {
            try? vm.bootstrapIfNeeded(context: modelContext)
            if vm.selectedBoardId == nil {
                vm.selectedBoardId = boards.first?.id
            }
        }
        .sheet(isPresented: $vm.showingAddBoard) {
            NavigationStack {
                Form {
                    Section("Board") {
                        TextField("Board name", text: $vm.newBoardName)
                        Picker("Type", selection: $vm.newBoardKind) {
                            Text("Week").tag("week")
                            Text("Lists").tag("lists")
                            Text("Compound").tag("compound")
                        }
                        .pickerStyle(.segmented)
                    }
                }
                .navigationTitle("Add Board")
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { vm.showingAddBoard = false }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Create") { try? vm.createBoard(context: modelContext) }
                    }
                }
            }
            .presentationDetents([.medium])
        }
    }

    private var selectedBoard: TaskifyBoard? {
        if let id = vm.selectedBoardId {
            return boards.first(where: { $0.id == id })
        }
        return boards.first
    }
}
