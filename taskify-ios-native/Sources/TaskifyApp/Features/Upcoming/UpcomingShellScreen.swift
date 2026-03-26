import SwiftUI

struct UpcomingShellScreen: View {
    var body: some View {
        NavigationStack {
            VStack(spacing: 10) {
                Image(systemName: "calendar")
                    .font(.title2)
                    .foregroundStyle(.secondary)
                Text("Upcoming")
                    .font(.title3.bold())
                Text("Native upcoming scaffold — parity slices in progress.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding(24)
            .navigationTitle("Upcoming")
        }
    }
}
