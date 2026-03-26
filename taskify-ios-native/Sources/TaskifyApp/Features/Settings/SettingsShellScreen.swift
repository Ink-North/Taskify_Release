import SwiftUI
import TaskifyCore

struct SettingsShellScreen: View {
    let profile: TaskifyProfile
    @EnvironmentObject private var authVM: AppAuthViewModel

    @State private var showSignOutConfirm = false
    @State private var showCopyNpub = false
    @State private var showRelayEditor = false
    @State private var editingRelays: [String] = []
    @State private var newRelayURL = ""

    var body: some View {
        NavigationStack {
            List {
                profileSection
                relaysSection
                boardsSection
                aboutSection
                signOutSection
            }
            .navigationTitle("Settings")
            .confirmationDialog("Sign Out", isPresented: $showSignOutConfirm) {
                Button("Sign Out", role: .destructive) {
                    authVM.signOut()
                }
            } message: {
                Text("You will need your nsec key to sign back in.")
            }
            .sheet(isPresented: $showRelayEditor) {
                relayEditorSheet
            }
        }
    }

    // MARK: - Profile Section

    private var profileSection: some View {
        Section {
            HStack(spacing: 14) {
                ZStack {
                    Circle()
                        .fill(Color.blue.opacity(0.15))
                        .frame(width: 48, height: 48)
                    Text(initials(from: profile.name))
                        .font(.title3.bold())
                        .foregroundStyle(.blue)
                }

                VStack(alignment: .leading, spacing: 2) {
                    Text(profile.name)
                        .font(.headline)
                    Text(truncatedNpub)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                Spacer()
            }
            .padding(.vertical, 4)

            Button(action: copyNpub) {
                Label("Copy npub", systemImage: "doc.on.doc")
            }
        } header: {
            Text("Profile")
        }
    }

    // MARK: - Relays Section

    private var relaysSection: some View {
        Section {
            ForEach(profile.relays, id: \.self) { relay in
                HStack(spacing: 8) {
                    Circle()
                        .fill(.green)
                        .frame(width: 8, height: 8)
                    Text(relay)
                        .font(.subheadline)
                        .lineLimit(1)
                }
            }

            Button(action: {
                editingRelays = profile.relays
                showRelayEditor = true
            }) {
                Label("Manage Relays", systemImage: "antenna.radiowaves.left.and.right")
            }
        } header: {
            Text("Relays")
        } footer: {
            Text("Relays are used to sync your tasks across devices via Nostr.")
        }
    }

    // MARK: - Boards Section

    private var boardsSection: some View {
        Section {
            if profile.boards.isEmpty {
                HStack {
                    Image(systemName: "tray")
                        .foregroundStyle(.secondary)
                    Text("No boards yet")
                        .foregroundStyle(.secondary)
                }
            } else {
                ForEach(profile.boards, id: \.id) { board in
                    HStack {
                        Image(systemName: "square.grid.2x2")
                            .foregroundStyle(.blue)
                        Text(board.name)
                        Spacer()
                        Text(String(board.id.prefix(8)) + "…")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        } header: {
            Text("Boards")
        } footer: {
            Text("\(profile.boards.count) board\(profile.boards.count == 1 ? "" : "s")")
        }
    }

    // MARK: - About Section

    private var aboutSection: some View {
        Section {
            HStack {
                Text("Version")
                Spacer()
                Text("1.0.0")
                    .foregroundStyle(.secondary)
            }
            HStack {
                Text("Platform")
                Spacer()
                Text("iOS Native")
                    .foregroundStyle(.secondary)
            }
        } header: {
            Text("About")
        }
    }

    // MARK: - Sign Out Section

    private var signOutSection: some View {
        Section {
            Button(role: .destructive, action: { showSignOutConfirm = true }) {
                Label("Sign Out", systemImage: "rectangle.portrait.and.arrow.right")
            }
        } footer: {
            Text("Make sure you have your nsec key backed up before signing out.")
        }
    }

    // MARK: - Relay Editor Sheet

    private var relayEditorSheet: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(editingRelays, id: \.self) { relay in
                        HStack {
                            Text(relay)
                                .font(.subheadline)
                            Spacer()
                            Button(action: { editingRelays.removeAll { $0 == relay } }) {
                                Image(systemName: "minus.circle.fill")
                                    .foregroundStyle(.red)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }

                Section {
                    HStack {
                        TextField("wss://relay.example.com", text: $newRelayURL)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .keyboardType(.URL)
                            .onSubmit { addRelay() }
                        Button("Add") { addRelay() }
                            .disabled(newRelayURL.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }

                Section {
                    Button("Reset to Defaults") {
                        editingRelays = AuthSessionManager.defaultRelayPreset
                    }
                }
            }
            .navigationTitle("Manage Relays")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { showRelayEditor = false }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        // Note: relay persistence will be wired to profile save when available
                        showRelayEditor = false
                    }
                    .bold()
                }
            }
        }
    }

    // MARK: - Helpers

    private func copyNpub() {
        UIPasteboard.general.string = profile.npub
        showCopyNpub = true
    }

    private var truncatedNpub: String {
        let npub = profile.npub
        guard npub.count > 20 else { return npub }
        return String(npub.prefix(12)) + "…" + String(npub.suffix(8))
    }

    private func initials(from name: String) -> String {
        let words = name.split(separator: " ").prefix(2)
        return words.map { String($0.prefix(1)).uppercased() }.joined()
    }

    private func addRelay() {
        let url = newRelayURL.trimmingCharacters(in: .whitespaces)
        guard !url.isEmpty, url.hasPrefix("wss://"), !editingRelays.contains(url) else { return }
        editingRelays.append(url)
        newRelayURL = ""
    }
}
