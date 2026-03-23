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
    private static let pendingKey = "taskify.voice.intent.pending"

    public static func savePending(_ payload: VoiceCaptureIntentPayload, defaults: UserDefaults = .standard) {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        guard let data = try? encoder.encode(payload) else { return }
        defaults.set(data, forKey: pendingKey)
    }

    public static func consumePending(defaults: UserDefaults = .standard) -> VoiceCaptureIntentPayload? {
        guard let data = defaults.data(forKey: pendingKey) else { return nil }
        defaults.removeObject(forKey: pendingKey)

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try? decoder.decode(VoiceCaptureIntentPayload.self, from: data)
    }
}
