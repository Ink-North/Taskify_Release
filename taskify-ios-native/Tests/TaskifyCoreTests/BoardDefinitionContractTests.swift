import Foundation
import Testing
@testable import TaskifyCore

@Suite("BoardDefinitionContract")
struct BoardDefinitionContractTests {

    @Test("list board payload encodes and decodes columns")
    func listPayloadRoundTrip() {
        let payload = BoardDefinitionPayload(
            clearCompletedDisabled: true,
            columns: [
                BoardColumn(id: "todo", name: "To Do"),
                BoardColumn(id: "done", name: "Done"),
            ],
            listIndex: true
        )

        let raw = BoardDefinitionCodec.encode(payload)
        let decoded = BoardDefinitionCodec.decode(raw)

        #expect(decoded == payload)
    }

    @Test("compound board payload preserves children and hide flag")
    func compoundPayloadRoundTrip() {
        let payload = BoardDefinitionPayload(
            clearCompletedDisabled: false,
            listIndex: true,
            children: ["board-a", "board-b"],
            hideBoardNames: true
        )

        let raw = BoardDefinitionCodec.encode(payload)
        let decoded = BoardDefinitionCodec.decode(raw)

        #expect(decoded == payload)
    }
}
