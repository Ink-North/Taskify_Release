import Foundation

public struct VoiceCaptureIntentPayload: Codable, Equatable {
    public let title: String
    public let dueDate: Date?
    public let boardName: String?

    public init(title: String, dueDate: Date?, boardName: String?) {
        self.title = title
        self.dueDate = dueDate
        self.boardName = boardName
    }
}

public enum VoiceCaptureIntentStore {
    // App Group shared container — readable by both the app and the App Intent extension process.
    // Falls back to UserDefaults.standard if the group container is unavailable (e.g. macOS/tests).
    public static let appGroupID = "group.solife.me.Taskify"
    private static let pendingKey = "taskify.voice.intent.pending"

    private static var sharedDefaults: UserDefaults {
        UserDefaults(suiteName: appGroupID) ?? .standard
    }

    public static func savePending(_ payload: VoiceCaptureIntentPayload, defaults: UserDefaults? = nil) {
        let target = defaults ?? sharedDefaults
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        guard let data = try? encoder.encode(payload) else { return }
        target.set(data, forKey: pendingKey)
        target.synchronize()
    }

    public static func consumePending(defaults: UserDefaults? = nil) -> VoiceCaptureIntentPayload? {
        let target = defaults ?? sharedDefaults
        guard let data = target.data(forKey: pendingKey) else { return nil }
        target.removeObject(forKey: pendingKey)
        target.synchronize()

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try? decoder.decode(VoiceCaptureIntentPayload.self, from: data)
    }
}
