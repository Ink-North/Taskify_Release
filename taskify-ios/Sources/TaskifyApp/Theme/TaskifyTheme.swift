import SwiftUI

enum TaskifyTheme {
    static let cardBackground = Color.secondary.opacity(0.12)
    static let boardBackground = Color.primary.opacity(0.04)
    static let accent = Color.blue
    static let done = Color.green
    static let priorityHigh = Color.red
    static let priorityMedium = Color.orange
    static let priorityLow = Color.yellow
}

extension View {
    func taskifyCardStyle() -> some View {
        self
            .padding(12)
            .background(TaskifyTheme.cardBackground)
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}
