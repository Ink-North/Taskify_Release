import Foundation

public struct BoardDefinitionPayload: Codable, Equatable {
    public var clearCompletedDisabled: Bool
    public var columns: [BoardColumn]?
    public var listIndex: Bool?
    public var children: [String]?
    public var hideBoardNames: Bool?

    public init(
        clearCompletedDisabled: Bool,
        columns: [BoardColumn]? = nil,
        listIndex: Bool? = nil,
        children: [String]? = nil,
        hideBoardNames: Bool? = nil
    ) {
        self.clearCompletedDisabled = clearCompletedDisabled
        self.columns = columns
        self.listIndex = listIndex
        self.children = children
        self.hideBoardNames = hideBoardNames
    }
}

public enum BoardDefinitionCodec {
    public static func encode(_ payload: BoardDefinitionPayload) -> String? {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        guard let data = try? encoder.encode(payload) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    public static func decode(_ raw: String?) -> BoardDefinitionPayload? {
        guard let raw,
              let data = raw.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(BoardDefinitionPayload.self, from: data)
    }
}
