import Foundation
import Testing
@testable import TaskifyCore

@MainActor
@Suite("UpcomingViewModel")
struct UpcomingViewModelTests {

    @Test("groups only open tasks with active due dates")
    func groupsOpenDatedTasks() {
        let vm = UpcomingViewModel()
        vm.setBoards([
            .init(id: "b1", name: "Work", kind: "lists", columns: []),
        ])
        vm.setTasks([
            .init(id: "t1", title: "Due soon", completed: false, dueISO: "2026-03-26T18:00:00Z", createdAt: 10, dueDateEnabled: true, boardId: "b1", boardName: "Work"),
            .init(id: "t2", title: "Done", completed: true, dueISO: "2026-03-26T19:00:00Z", createdAt: 11, dueDateEnabled: true, boardId: "b1", boardName: "Work"),
            .init(id: "t3", title: "No due", completed: false, dueISO: nil, createdAt: 12, dueDateEnabled: true, boardId: "b1", boardName: "Work"),
            .init(id: "t4", title: "Disabled due", completed: false, dueISO: "2026-03-27T18:00:00Z", createdAt: 13, dueDateEnabled: false, boardId: "b1", boardName: "Work"),
        ])

        #expect(vm.itemCount == 1)
        #expect(vm.groups.count == 1)
        #expect(vm.groups.first?.tasks.map(\.id) == ["t1"])
    }

    @Test("search matches task notes in addition to title")
    func searchMatchesNotes() {
        let vm = UpcomingViewModel()
        vm.setBoards([
            .init(id: "b1", name: "Work", kind: "lists", columns: []),
        ])
        vm.setTasks([
            .init(id: "t1", title: "Draft memo", completed: false, dueISO: "2026-03-26T18:00:00Z", createdAt: 10, note: "Share with finance", dueDateEnabled: true, boardId: "b1", boardName: "Work"),
            .init(id: "t2", title: "Review", completed: false, dueISO: "2026-03-26T20:00:00Z", createdAt: 11, note: "Legal pass", dueDateEnabled: true, boardId: "b1", boardName: "Work"),
        ])

        vm.searchText = "finance"

        #expect(vm.itemCount == 1)
        #expect(vm.filteredTasks.map(\.id) == ["t1"])
    }

    @Test("list filters constrain tasks to selected columns")
    func listFiltersConstrainColumns() {
        let vm = UpcomingViewModel()
        vm.setBoards([
            .init(
                id: "b1",
                name: "Work",
                kind: "lists",
                columns: [
                    .init(id: "todo", name: "Todo"),
                    .init(id: "doing", name: "Doing"),
                ]
            ),
            .init(id: "b2", name: "Home", kind: "week", columns: []),
        ])
        vm.setTasks([
            .init(id: "t1", title: "Todo item", completed: false, dueISO: "2026-03-26T18:00:00Z", createdAt: 10, columnId: "todo", dueDateEnabled: true, boardId: "b1", boardName: "Work"),
            .init(id: "t2", title: "Doing item", completed: false, dueISO: "2026-03-26T19:00:00Z", createdAt: 11, columnId: "doing", dueDateEnabled: true, boardId: "b1", boardName: "Work"),
            .init(id: "t3", title: "Home item", completed: false, dueISO: "2026-03-26T20:00:00Z", createdAt: 12, dueDateEnabled: true, boardId: "b2", boardName: "Home"),
        ])

        vm.setSelectedFilterIDs(Set(["board:b1:col:todo"]))

        #expect(vm.selectedFilterIDs == Optional(Set(["board:b1", "board:b1:col:todo"])))
        #expect(vm.filteredTasks.map(\.id) == ["t1"])
    }

    @Test("grouped board ordering overrides mixed sort order inside a day")
    func groupedBoardOrdering() {
        let vm = UpcomingViewModel()
        vm.setBoards([
            .init(id: "b1", name: "First", kind: "lists", columns: []),
            .init(id: "b2", name: "Second", kind: "lists", columns: []),
        ])
        vm.setTasks([
            .init(id: "t1", title: "Zulu", completed: false, dueISO: "2026-03-26T18:00:00Z", createdAt: 10, dueDateEnabled: true, boardId: "b1", boardName: "First"),
            .init(id: "t2", title: "Alpha", completed: false, dueISO: "2026-03-26T18:00:00Z", createdAt: 11, dueDateEnabled: true, boardId: "b2", boardName: "Second"),
        ])

        vm.selectSortMode(.alphabetical)
        #expect(vm.groups.first?.tasks.map(\.id) == ["t2", "t1"])

        vm.setBoardGrouping(.grouped)
        #expect(vm.groups.first?.tasks.map(\.id) == ["t1", "t2"])
    }

    @Test("location label includes list name for list boards")
    func locationLabelIncludesListName() {
        let vm = UpcomingViewModel()
        vm.setBoards([
            .init(
                id: "b1",
                name: "Work",
                kind: "lists",
                columns: [.init(id: "todo", name: "Todo")]
            ),
        ])

        let task = BoardTaskItem(
            id: "t1",
            title: "Ship build",
            completed: false,
            dueISO: "2026-03-26T18:00:00Z",
            createdAt: 10,
            columnId: "todo",
            dueDateEnabled: true,
            boardId: "b1",
            boardName: "Work"
        )

        #expect(vm.locationLabel(for: task) == "Work • Todo")
    }
}
