import Foundation

public enum VoiceCaptureURLBuilder {
    /// Builds a URL for the hosted Taskify web app to prefill quick-add fields.
    /// Returns nil if title is empty after trimming.
    public static func quickAddURL(baseURL: URL, title: String, dueDate: Date?, boardName: String?) -> URL? {
        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedTitle.isEmpty else { return nil }

        var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)
        var items = components?.queryItems ?? []
        items.append(URLQueryItem(name: "quickAdd", value: trimmedTitle))
        items.append(URLQueryItem(name: "source", value: "ios-intent"))

        if let dueDate {
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime]
            items.append(URLQueryItem(name: "due", value: formatter.string(from: dueDate)))
        }

        let trimmedBoardName = boardName?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let trimmedBoardName, !trimmedBoardName.isEmpty {
            items.append(URLQueryItem(name: "board", value: trimmedBoardName))
        }

        components?.queryItems = items
        return components?.url
    }
}
