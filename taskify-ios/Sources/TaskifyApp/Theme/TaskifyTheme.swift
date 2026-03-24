import SwiftUI

enum TaskifyTheme {
    static let bgTop = Color(red: 0.07, green: 0.13, blue: 0.24)
    static let bgBottom = Color(red: 0.03, green: 0.06, blue: 0.12)
    static let panel = Color.white.opacity(0.08)
    static let panelStrong = Color.white.opacity(0.12)
    static let stroke = Color.white.opacity(0.10)
    static let strokeStrong = Color.white.opacity(0.18)
    static let textPrimary = Color.white
    static let textSecondary = Color.white.opacity(0.72)
    static let textTertiary = Color.white.opacity(0.52)
    static let accent = Color(red: 0.24, green: 0.55, blue: 1.00)
    static let accentSoft = Color(red: 0.24, green: 0.55, blue: 1.00).opacity(0.18)
    static let done = Color(red: 0.29, green: 0.84, blue: 0.53)
    static let priorityHigh = Color(red: 1.00, green: 0.42, blue: 0.42)
    static let priorityMedium = Color(red: 1.00, green: 0.72, blue: 0.32)
    static let priorityLow = Color(red: 0.95, green: 0.84, blue: 0.38)

    static let pwaControl = Color(red: 0.10, green: 0.16, blue: 0.29).opacity(0.34)
    static let pwaControlStroke = Color.white.opacity(0.18)
    static let pwaBoard = Color(red: 0.09, green: 0.15, blue: 0.28).opacity(0.26)
    static let pwaBoardStroke = Color.white.opacity(0.18)
    static let pwaTask = Color(red: 0.11, green: 0.18, blue: 0.31).opacity(0.28)
    static let pwaTaskStroke = Color.white.opacity(0.18)
    static let pwaDock = Color(red: 0.08, green: 0.13, blue: 0.24).opacity(0.34)
}

struct TaskifyBackground: View {
    var body: some View {
        LinearGradient(colors: [TaskifyTheme.bgTop, TaskifyTheme.bgBottom], startPoint: .topLeading, endPoint: .bottomTrailing)
            .overlay(
                RadialGradient(colors: [TaskifyTheme.accent.opacity(0.18), .clear], center: .topTrailing, startRadius: 20, endRadius: 420)
            )
            .ignoresSafeArea()
    }
}

extension View {
    func taskifyCardStyle(strong: Bool = false) -> some View {
        self
            .padding(14)
            .background((strong ? TaskifyTheme.panelStrong : TaskifyTheme.panel))
            .overlay(
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .stroke(TaskifyTheme.stroke, lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    func frostedGlass(cornerRadius: CGFloat = 26, tint: Color = Color.white.opacity(0.08), stroke: Color = TaskifyTheme.stroke) -> some View {
        self
            .background(.ultraThinMaterial)
            .background(tint)
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .stroke(stroke, lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
    }

    func pwaSurface(cornerRadius: CGFloat = 28, fill: Color, stroke: Color) -> some View {
        self
            .background(.ultraThinMaterial)
            .background(fill)
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .stroke(stroke, lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
    }

    func taskifyScreen() -> some View {
        self
            .foregroundStyle(TaskifyTheme.textPrimary)
            .background(TaskifyBackground())
    }
}
