import Foundation
import Testing
@testable import TaskifyCore

@MainActor
@Suite("ListColumnsViewModel")
struct ListColumnsViewModelTests {

    @Test("lists board maps direct columns and source map")
    func listsBoardColumns() {
        let vm = ListColumnsViewModel()
        let board = ListBoardDefinition(
            id: "b1",
            name: "Work",
            kind: .lists,
            columns: [.init(id: "c1", name: "Todo"), .init(id: "c2", name: "Doing")]
        )

        vm.configure(currentBoard: board, boards: [board])

        #expect(vm.listColumns.map(\.id) == ["c1", "c2"])
        #expect(vm.listColumnSources["c1"]?.boardId == "b1")
        #expect(vm.listColumnSources["c2"]?.columnId == "c2")
    }

    @Test("compound board maps canonical child keys and groups")
    func compoundColumns() {
        let child = ListBoardDefinition(
            id: "child-1",
            name: "Bugs",
            kind: .lists,
            columns: [.init(id: "todo", name: "Todo")]
        )
        let compound = ListBoardDefinition(
            id: "cmp",
            name: "All",
            kind: .compound,
            columns: [],
            children: ["child-1"]
        )
        let vm = ListColumnsViewModel()

        vm.configure(currentBoard: compound, boards: [compound, child])

        #expect(vm.listColumns.map(\.id) == ["child-1:todo"])
        #expect(vm.listColumnSources["child-1:todo"]?.boardName == "Bugs")
        #expect(vm.compoundIndexGroups.count == 1)
        #expect(vm.compoundIndexGroups.first?.columns.first?.id == "child-1:todo")
    }

    @Test("items map by column for lists and compound")
    func itemsByColumn() {
        let child = ListBoardDefinition(
            id: "child-1",
            name: "Bugs",
            kind: .lists,
            columns: [.init(id: "todo", name: "Todo")]
        )
        let compound = ListBoardDefinition(
            id: "cmp",
            name: "All",
            kind: .compound,
            columns: [],
            children: ["child-1"]
        )
        let vm = ListColumnsViewModel()

        vm.configure(currentBoard: compound, boards: [compound, child])
        vm.setTasks([
            .init(id: "t1", boardId: "child-1", columnId: "todo", title: "Fix crash", completed: false)
        ])

        #expect(vm.itemsByColumn["child-1:todo"]?.count == 1)
    }

    @Test("add list and inline task entry points on lists board")
    func addEntryPoints() {
        let board = ListBoardDefinition(
            id: "b1",
            name: "Work",
            kind: .lists,
            columns: [.init(id: "c1", name: "Todo")]
        )
        let vm = ListColumnsViewModel()
        vm.configure(currentBoard: board, boards: [board])

        let newColumnId = vm.addList(name: "Done")
        #expect(newColumnId == "col-2")
        #expect(vm.listColumns.count == 2)

        vm.addInlineTask(columnId: "c1", title: "Ship build")
        #expect(vm.itemsByColumn["c1"]?.first?.title == "Ship build")
    }
}
