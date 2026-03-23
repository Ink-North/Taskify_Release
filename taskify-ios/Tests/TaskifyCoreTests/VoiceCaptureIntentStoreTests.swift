import XCTest
@testable import TaskifyCore

final class VoiceCaptureIntentStoreTests: XCTestCase {
    func testSaveAndConsumePendingPayload() {
        let defaults = UserDefaults(suiteName: "VoiceCaptureIntentStoreTests")!
        defaults.removePersistentDomain(forName: "VoiceCaptureIntentStoreTests")

        let payload = VoiceCaptureIntentPayload(
            title: "Buy milk",
            dueDate: Date(timeIntervalSince1970: 1_700_000_000),
            boardName: "Work"
        )

        VoiceCaptureIntentStore.savePending(payload, defaults: defaults)

        let consumed = VoiceCaptureIntentStore.consumePending(defaults: defaults)
        XCTAssertEqual(consumed, payload)

        let secondConsume = VoiceCaptureIntentStore.consumePending(defaults: defaults)
        XCTAssertNil(secondConsume)
    }
}
