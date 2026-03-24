import SwiftUI

struct PillButton: View {
    let title: String
    let systemImage: String
    var selected: Bool = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: systemImage)
                Text(title)
                    .font(.subheadline.weight(.semibold))
            }
            .foregroundStyle(selected ? TaskifyTheme.textPrimary : TaskifyTheme.textSecondary)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(selected ? TaskifyTheme.accentSoft : Color.white.opacity(0.06))
            .overlay(
                Capsule().stroke(selected ? TaskifyTheme.accent.opacity(0.5) : TaskifyTheme.stroke, lineWidth: 1)
            )
            .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }
}
