import Foundation

public enum BoardColumnDerivation {
    public static func deriveColumns(from tasks: [BoardTaskItem]) -> [BoardColumn] {
        let ids = Array(Set(tasks.compactMap { $0.columnId?.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }))
            .sorted()

        if ids.isEmpty {
            return [
                .init(id: "todo", name: "To do"),
                .init(id: "doing", name: "Doing"),
                .init(id: "done", name: "Done"),
            ]
        }

        return ids.map { .init(id: $0, name: prettify($0)) }
    }

    private static func prettify(_ raw: String) -> String {
        raw
            .replacingOccurrences(of: "-", with: " ")
            .replacingOccurrences(of: "_", with: " ")
            .split(separator: " ")
            .map { $0.prefix(1).uppercased() + $0.dropFirst().lowercased() }
            .joined(separator: " ")
    }
}
