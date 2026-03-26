import Foundation
import Testing
@testable import TaskifyCore

@Suite("BoardColumnDerivation")
struct BoardColumnDerivationTests {

    @Test("derives unique sorted columns from task column ids")
    func derivesColumnsFromTasks() {
        let tasks: [BoardTaskItem] = [
            .init(id: "1", title: "A", completed: false, columnId: "inbox"),
            .init(id: "2", title: "B", completed: false, columnId: "doing"),
            .init(id: "3", title: "C", completed: true, columnId: "inbox"),
        ]

        let cols = BoardColumnDerivation.deriveColumns(from: tasks)
        #expect(cols.map(\.id) == ["doing", "inbox"])
        #expect(cols.first?.name == "Doing")
    }

    @Test("falls back to defaults when no task columns")
    func fallbackColumns() {
        let cols = BoardColumnDerivation.deriveColumns(from: [
            .init(id: "1", title: "A", completed: false, columnId: nil)
        ])
        #expect(cols.map(\.id) == ["todo", "doing", "done"])
    }
}
