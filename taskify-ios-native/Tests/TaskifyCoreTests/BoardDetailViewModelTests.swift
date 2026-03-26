import Foundation
import Testing
@testable import TaskifyCore

@MainActor
@Suite("BoardDetailViewModel")
struct BoardDetailViewModelTests {

    @Test("selected board with no tasks is empty")
    func selectedBoardEmpty() {
        let vm = BoardDetailViewModel()
        vm.setSelectedBoard(id: "b1")
        #expect(vm.state == .empty)
        #expect(vm.visibleTasks.isEmpty)
    }

    @Test("setting tasks for selected board becomes ready")
    func selectedBoardTasksReady() {
        let vm = BoardDetailViewModel()
        vm.setSelectedBoard(id: "b1")
        vm.setTasks(for: "b1", tasks: [
            BoardTaskItem(id: "t1", title: "Buy milk", completed: false),
            BoardTaskItem(id: "t2", title: "Call Ink", completed: true),
        ])

        #expect(vm.state == .ready)
        #expect(vm.visibleTasks.count == 2)
    }

    @Test("tasks for non-selected board do not affect visible list")
    func nonSelectedBoardTasksIgnoredUntilSelection() {
        let vm = BoardDetailViewModel()
        vm.setSelectedBoard(id: "b1")
        vm.setTasks(for: "b2", tasks: [BoardTaskItem(id: "x", title: "Other", completed: false)])
        #expect(vm.state == .empty)

        vm.setSelectedBoard(id: "b2")
        #expect(vm.state == .ready)
        #expect(vm.visibleTasks.count == 1)
    }

    @Test("loading and error states are representable")
    func loadingAndError() {
        let vm = BoardDetailViewModel()
        vm.setLoading()
        #expect(vm.state == .loading)
        vm.setError("Failed to load tasks")
        #expect(vm.state == .error("Failed to load tasks"))
    }

    @Test("clear completed removes completed tasks from selected board")
    func clearCompleted() {
        let vm = BoardDetailViewModel()
        vm.setSelectedBoard(id: "b1")
        vm.setTasks(for: "b1", tasks: [
            BoardTaskItem(id: "t1", title: "A", completed: false),
            BoardTaskItem(id: "t2", title: "B", completed: true),
        ])

        let removed = vm.clearCompletedForSelectedBoard()
        #expect(removed == 1)
        #expect(vm.visibleTasks.count == 1)
        #expect(vm.visibleTasks.first?.id == "t1")
    }

    @Test("upcoming tasks include only non-completed tasks with due dates")
    func upcomingProjection() {
        let vm = BoardDetailViewModel()
        vm.setSelectedBoard(id: "b1")
        vm.setTasks(for: "b1", tasks: [
            BoardTaskItem(id: "t1", title: "Due soon", completed: false, dueISO: "2026-03-26T10:00:00Z"),
            BoardTaskItem(id: "t2", title: "Done", completed: true, dueISO: "2026-03-26T10:00:00Z"),
            BoardTaskItem(id: "t3", title: "No due", completed: false, dueISO: nil),
        ])

        #expect(vm.upcomingTasks().map(\.id) == ["t1"])
    }

    @Test("task column id is preserved")
    func taskColumnPreserved() {
        let vm = BoardDetailViewModel()
        vm.setSelectedBoard(id: "b1")
        vm.setTasks(for: "b1", tasks: [
            BoardTaskItem(id: "t1", title: "Lane item", completed: false, columnId: "doing"),
        ])

        #expect(vm.visibleTasks.first?.columnId == "doing")
    }

    @Test("fixtures produce deterministic states")
    func fixtures() {
        #expect(BoardDetailFixture.empty(boardId: "b1").state == .empty)
        #expect(BoardDetailFixture.loading(boardId: "b1").state == .loading)
        #expect(BoardDetailFixture.error(boardId: "b1", message: "x").state == .error("x"))
        #expect(BoardDetailFixture.sample(boardId: "b1").visibleTasks.count == 3)
    }
}
