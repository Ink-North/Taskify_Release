import SwiftUI

struct SettingsView: View {
    let onBoardsTap: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Text("Settings")
                    .font(.system(size: 32, weight: .bold, design: .rounded))
                Text("PWA-style controls, translated into native SwiftUI.")
                    .font(.subheadline)
                    .foregroundStyle(TaskifyTheme.textSecondary)

                GlassSectionCard(title: "Boards & Lists", subtitle: "Manage structure and navigation") {
                    VStack(spacing: 12) {
                        settingsRow(title: "Open Boards", icon: "square.grid.2x2") {
                            onBoardsTap()
                        }
                        settingsRow(title: "Join Shared Board", icon: "link.badge.plus") {}
                        settingsRow(title: "Create Board", icon: "plus.circle") {}
                    }
                }

                GlassSectionCard(title: "Appearance", subtitle: "Theme and layout") {
                    VStack(spacing: 12) {
                        settingsStaticRow(title: "Theme", value: "Dark")
                        settingsStaticRow(title: "Layout", value: "Native PWA-style")
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 18)
            .padding(.bottom, 140)
        }
        .taskifyScreen()
    }

    private func settingsRow(title: String, icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: icon)
                    .frame(width: 28)
                    .foregroundStyle(TaskifyTheme.accent)
                Text(title)
                    .foregroundStyle(TaskifyTheme.textPrimary)
                Spacer()
                Image(systemName: "chevron.right")
                    .foregroundStyle(TaskifyTheme.textSecondary)
            }
            .padding(14)
            .background(Color.white.opacity(0.05))
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    private func settingsStaticRow(title: String, value: String) -> some View {
        HStack {
            Text(title)
                .foregroundStyle(TaskifyTheme.textSecondary)
            Spacer()
            Text(value)
                .foregroundStyle(TaskifyTheme.textPrimary)
        }
        .padding(14)
        .background(Color.white.opacity(0.05))
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}
