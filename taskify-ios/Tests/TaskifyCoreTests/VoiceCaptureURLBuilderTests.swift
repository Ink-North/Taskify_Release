import XCTest
@testable import TaskifyCore

final class VoiceCaptureURLBuilderTests: XCTestCase {
    func testBuildQuickAddURL_withTitle_only() throws {
        let url = try XCTUnwrap(VoiceCaptureURLBuilder.quickAddURL(baseURL: URL(string: "https://taskify.solife.me")!, title: "Buy milk", dueDate: nil, boardName: nil))
        let absolute = url.absoluteString
        XCTAssertTrue(absolute.contains("quickAdd=Buy%20milk"))
        XCTAssertTrue(absolute.contains("source=ios-intent"))
        XCTAssertFalse(absolute.contains("due="))
    }

    func testBuildQuickAddURL_withTitle_andDueDate() throws {
        let due = Date(timeIntervalSince1970: 1_700_000_000)
        let url = try XCTUnwrap(VoiceCaptureURLBuilder.quickAddURL(baseURL: URL(string: "https://taskify.solife.me")!, title: "Call mom", dueDate: due, boardName: nil))
        let absolute = url.absoluteString
        XCTAssertTrue(absolute.contains("quickAdd=Call%20mom"))
        XCTAssertTrue(absolute.contains("due=2023-11-14T22:13:20Z"))
    }

    func testBuildQuickAddURL_withBoardName() throws {
        let url = try XCTUnwrap(VoiceCaptureURLBuilder.quickAddURL(baseURL: URL(string: "https://taskify.solife.me")!, title: "Plan sprint", dueDate: nil, boardName: "Work"))
        let absolute = url.absoluteString
        XCTAssertTrue(absolute.contains("board=Work"))
    }

    func testBuildQuickAddURL_rejectsEmptyTitle() {
        let url = VoiceCaptureURLBuilder.quickAddURL(baseURL: URL(string: "https://taskify.solife.me")!, title: "   ", dueDate: nil, boardName: nil)
        XCTAssertNil(url)
    }
}
