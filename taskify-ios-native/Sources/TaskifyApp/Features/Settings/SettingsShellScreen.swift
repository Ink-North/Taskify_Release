import SwiftUI

struct SettingsShellScreen: View {
    let profileName: String

    var body: some View {
        NavigationStack {
            VStack(spacing: 10) {
                Image(systemName: "gearshape")
                    .font(.title2)
                    .foregroundStyle(.secondary)
                Text("Signed in as \(profileName)")
                    .font(.title3.bold())
                Text("Native settings scaffold — parity slices in progress.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding(24)
            .navigationTitle("Settings")
        }
    }
}
