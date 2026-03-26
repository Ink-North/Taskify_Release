import CoreImage.CIFilterBuiltins
import SwiftUI
import TaskifyCore

struct ContactsShellScreen: View {
    let profile: TaskifyProfile

    @EnvironmentObject private var dataController: DataController
    @EnvironmentObject private var settingsManager: SettingsManager
    @StateObject private var viewModel = ContactsViewModel()

    @State private var searchText = ""
    @State private var showAddSheet = false
    @State private var showProfileSheet = false
    @State private var activeContact: TaskifyContactRecord?
    @State private var editingContact: TaskifyContactRecord?
    @State private var didInitialLoad = false

    private var myCard: TaskifyContactRecord {
        let metadata = dataController.myProfileMetadata
        return TaskifyContactRecord(
            id: "profile",
            kind: .nostr,
            name: metadata.displayName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                ? (sanitizeUsername(metadata.username).isEmpty ? profile.name : sanitizeUsername(metadata.username))
                : metadata.displayName,
            address: metadata.lud16,
            paymentRequest: "",
            npub: profile.npub,
            username: metadata.username.isEmpty ? nil : metadata.username,
            displayName: metadata.displayName.isEmpty ? nil : metadata.displayName,
            nip05: metadata.nip05.isEmpty ? nil : metadata.nip05,
            about: metadata.about.isEmpty ? nil : metadata.about,
            picture: metadata.picture.isEmpty ? nil : metadata.picture,
            relays: profile.relays,
            createdAt: metadata.updatedAt ?? 0,
            updatedAt: metadata.updatedAt ?? 0,
            source: .profile
        )
    }

    private var filteredContacts: [TaskifyContactRecord] {
        viewModel.filteredContacts(searchText: searchText)
    }

    var body: some View {
        NavigationStack {
            Group {
                switch viewModel.state {
                case .loading:
                    ProgressView("Loading contacts…")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                case .error(let message):
                    ContentUnavailableView("Contacts Unavailable", systemImage: "person.crop.circle.badge.exclamationmark", description: Text(message))
                case .empty, .ready:
                    listContent
                }
            }
            .navigationTitle("Contacts")
            .searchable(text: $searchText, prompt: "Search contacts")
            .toolbar {
                ToolbarItem(placement: PlatformToolbarPlacement.trailing) {
                    Button {
                        Task {
                            _ = await dataController.syncContactsFromNostr()
                            refreshLocalState()
                        }
                    } label: {
                        if dataController.contactSyncState.status == .loading {
                            ProgressView()
                                .controlSize(.small)
                        } else {
                            Image(systemName: "arrow.triangle.2.circlepath")
                        }
                    }
                    .accessibilityLabel("Sync contacts")
                }

                ToolbarItem(placement: PlatformToolbarPlacement.trailing) {
                    Button {
                        showAddSheet = true
                    } label: {
                        Image(systemName: "plus")
                    }
                    .accessibilityLabel("Add contact")
                }
            }
            .task {
                guard !didInitialLoad else { return }
                didInitialLoad = true
                refreshLocalState()
                _ = await dataController.loadMyProfileMetadata()
                _ = await dataController.syncContactsFromNostr(silent: true)
                await dataController.refreshContactProfiles()
                refreshLocalState()
            }
            .onChange(of: dataController.contactsVersion) { _, _ in refreshLocalState() }
            .onChange(of: dataController.publicFollowsVersion) { _, _ in refreshLocalState() }
            .sheet(isPresented: $showAddSheet) {
                ContactEditorSheet(
                    title: "New Contact",
                    initialDraft: TaskifyContactDraft(kind: .custom, source: .manual),
                    publicFollows: viewModel.importableFollows(),
                    onLookup: { value in
                        try await dataController.lookupContact(reference: value)
                    },
                    onSave: { draft in
                        let saved = await dataController.saveContact(draft)
                        refreshLocalState()
                        return saved != nil
                    }
                )
            }
            .sheet(isPresented: $showProfileSheet) {
                ProfileMetadataEditorSheet(
                    initialMetadata: dataController.myProfileMetadata,
                    profileName: profile.name,
                    npub: profile.npub,
                    onSave: { metadata in
                        let state = await dataController.publishMyProfileMetadata(metadata)
                        refreshLocalState()
                        return state.status == .success
                    }
                )
            }
            .sheet(item: $editingContact) { contact in
                ContactEditorSheet(
                    title: "Edit Contact",
                    initialDraft: draft(from: contact),
                    publicFollows: [],
                    onLookup: { value in
                        try await dataController.lookupContact(reference: value)
                    },
                    onSave: { draft in
                        let saved = await dataController.saveContact(draft)
                        refreshLocalState()
                        return saved != nil
                    }
                )
            }
            .sheet(item: $activeContact) { contact in
                ContactDetailSheet(
                    contact: contact,
                    fields: viewModel.fields(for: contact),
                    shareValue: dataController.contactShareValue(contactId: contact.id),
                    onEdit: { editingContact = contact },
                    onDelete: {
                        _ = await dataController.deleteContact(id: contact.id)
                        refreshLocalState()
                        activeContact = nil
                    }
                )
                .presentationDetents([.medium, .large])
            }
        }
    }

    private var listContent: some View {
        List {
            Section {
                Button {
                    showProfileSheet = true
                } label: {
                    ContactRowView(
                        contact: myCard,
                        subtitle: contactSubtitle(myCard) ?? "My Card",
                        accent: ThemeColors.accent(for: settingsManager.settings.accent)
                    )
                }
                .buttonStyle(.plain)
            } footer: {
                if let message = dataController.contactSyncState.message, !message.isEmpty {
                    Text(message)
                }
            }

            Section("Saved Contacts") {
                if filteredContacts.isEmpty {
                    ContentUnavailableView("No Contacts Yet", systemImage: "person.crop.circle.badge.plus", description: Text("Import an `npub`, paste a `nip05`, or add a custom contact."))
                        .padding(.vertical, 16)
                } else {
                    ForEach(filteredContacts) { contact in
                        Button {
                            activeContact = contact
                        } label: {
                            ContactRowView(
                                contact: contact,
                                subtitle: contactSubtitle(contact) ?? "No details added",
                                accent: ThemeColors.accent(for: settingsManager.settings.accent)
                            )
                        }
                        .buttonStyle(.plain)
                        .swipeActions(edge: .trailing) {
                            Button(role: .destructive) {
                                Task {
                                    _ = await dataController.deleteContact(id: contact.id)
                                    refreshLocalState()
                                }
                            } label: {
                                Label("Delete", systemImage: "trash")
                            }

                            Button {
                                editingContact = contact
                            } label: {
                                Label("Edit", systemImage: "pencil")
                            }
                            .tint(ThemeColors.accent(for: settingsManager.settings.accent))
                        }
                    }
                }
            }
        }
        .platformInsetGroupedListStyle()
    }

    private func refreshLocalState() {
        viewModel.setContacts(dataController.fetchContacts())
        viewModel.setPublicFollows(dataController.fetchPublicFollows())
    }

    private func draft(from contact: TaskifyContactRecord) -> TaskifyContactDraft {
        TaskifyContactDraft(
            id: contact.id,
            kind: contact.kind,
            name: contact.name,
            address: contact.address,
            paymentRequest: contact.paymentRequest,
            npub: contact.npub,
            username: contact.username ?? "",
            displayName: contact.displayName ?? "",
            nip05: contact.nip05 ?? "",
            about: contact.about ?? "",
            picture: contact.picture ?? "",
            relays: contact.relays,
            source: contact.source
        )
    }
}

private struct ContactRowView: View {
    let contact: TaskifyContactRecord
    let subtitle: String
    let accent: Color

    var body: some View {
        HStack(spacing: 14) {
            ContactAvatarView(contact: contact, accent: accent, size: 46)

            VStack(alignment: .leading, spacing: 4) {
                Text(contactPrimaryName(contact))
                    .font(.headline)
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                Text(subtitle)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            Spacer()

            Image(systemName: "chevron.right")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.tertiary)
        }
        .padding(.vertical, 6)
    }
}

private struct ContactAvatarView: View {
    let contact: TaskifyContactRecord
    let accent: Color
    let size: CGFloat

    var body: some View {
        Group {
            if let picture = contact.picture,
               let url = URL(string: picture),
               !picture.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image.resizable().scaledToFill()
                    default:
                        initialsView
                    }
                }
            } else {
                initialsView
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
    }

    private var initialsView: some View {
        ZStack {
            Circle()
                .fill(accent.opacity(0.14))
            Text(contactInitials(contactPrimaryName(contact)))
                .font(.system(size: size * 0.34, weight: .semibold, design: .rounded))
                .foregroundStyle(accent)
        }
    }
}

private struct ContactDetailSheet: View {
    let contact: TaskifyContactRecord
    let fields: [ContactField]
    let shareValue: String?
    let onEdit: () -> Void
    let onDelete: () async -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    VStack(spacing: 16) {
                        if let shareValue, !shareValue.isEmpty {
                            TaskifyQRCodeView(value: shareValue)
                                .frame(width: 220, height: 220)
                                .padding(16)
                                .background(ThemeColors.surfaceRaised)
                                .clipShape(RoundedRectangle(cornerRadius: 24))
                        }

                        ContactAvatarView(contact: contact, accent: ThemeColors.accentBlue, size: 88)

                        VStack(spacing: 6) {
                            Text(contactPrimaryName(contact))
                                .font(.title2.weight(.semibold))
                                .multilineTextAlignment(.center)
                            if !formatContactUsername(contact.username).isEmpty {
                                Text(formatContactUsername(contact.username))
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }

                    if let shareValue, !shareValue.isEmpty {
                        ShareLink(item: shareValue) {
                            Label("Share Contact", systemImage: "square.and.arrow.up")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                    }

                    VStack(spacing: 12) {
                        ForEach(fields) { field in
                            VStack(alignment: .leading, spacing: 6) {
                                Text(field.label)
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(.secondary)
                                Button {
                                    PlatformServices.copyToPasteboard(field.value)
                                } label: {
                                    Text(field.value)
                                        .font(field.multiline ? .body : .body.monospaced())
                                        .foregroundStyle(.primary)
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                        .multilineTextAlignment(.leading)
                                        .padding(12)
                                        .background(ThemeColors.surfaceRaised)
                                        .clipShape(RoundedRectangle(cornerRadius: 14))
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }

                    HStack(spacing: 12) {
                        Button("Edit") {
                            dismiss()
                            onEdit()
                        }
                        .buttonStyle(.bordered)
                        .frame(maxWidth: .infinity)

                        Button("Delete", role: .destructive) {
                            Task {
                                await onDelete()
                                dismiss()
                            }
                        }
                        .buttonStyle(.bordered)
                        .frame(maxWidth: .infinity)
                    }
                }
                .padding(20)
            }
            .navigationTitle("Contact")
            .platformInlineTitle()
            .toolbar {
                ToolbarItem(placement: PlatformToolbarPlacement.trailing) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}

private struct ContactEditorSheet: View {
    let title: String
    let initialDraft: TaskifyContactDraft
    let publicFollows: [TaskifyPublicFollowRecord]
    let onLookup: (String) async throws -> TaskifyContactDraft
    let onSave: (TaskifyContactDraft) async -> Bool

    @Environment(\.dismiss) private var dismiss

    @State private var draft: TaskifyContactDraft
    @State private var lookupValue = ""
    @State private var saveError: String?
    @State private var lookupBusy = false
    @State private var saveBusy = false

    init(
        title: String,
        initialDraft: TaskifyContactDraft,
        publicFollows: [TaskifyPublicFollowRecord],
        onLookup: @escaping (String) async throws -> TaskifyContactDraft,
        onSave: @escaping (TaskifyContactDraft) async -> Bool
    ) {
        self.title = title
        self.initialDraft = initialDraft
        self.publicFollows = publicFollows
        self.onLookup = onLookup
        self.onSave = onSave
        _draft = State(initialValue: initialDraft)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Import") {
                    TextField("npub1… or name@example.com", text: $lookupValue)
                        .platformNoAutoCaps()
                    Button {
                        Task {
                            lookupBusy = true
                            defer { lookupBusy = false }
                            do {
                                draft = try await onLookup(lookupValue)
                                saveError = nil
                            } catch {
                                saveError = error.localizedDescription
                            }
                        }
                    } label: {
                        if lookupBusy {
                            ProgressView()
                        } else {
                            Label("Import Contact", systemImage: "arrow.down.circle")
                        }
                    }

                    if !publicFollows.isEmpty {
                        ForEach(publicFollows.prefix(6)) { follow in
                            Button {
                                Task {
                                    lookupBusy = true
                                    defer { lookupBusy = false }
                                    do {
                                        draft = try await onLookup(formatContactNpub(follow.pubkey))
                                        saveError = nil
                                    } catch {
                                        saveError = error.localizedDescription
                                    }
                                }
                            } label: {
                                let formattedUsername = formatContactUsername(follow.username)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(
                                        follow.petname
                                            ?? follow.nip05
                                            ?? (formattedUsername.isEmpty ? formatContactNpub(follow.pubkey) : formattedUsername)
                                    )
                                    Text(follow.nip05 ?? formatContactNpub(follow.pubkey))
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                }

                Section("Details") {
                    Picker("Type", selection: $draft.kind) {
                        Text("Custom").tag(TaskifyContactKind.custom)
                        Text("Nostr").tag(TaskifyContactKind.nostr)
                    }
                    TextField("Nickname", text: $draft.name)
                    TextField("Display name", text: $draft.displayName)
                    TextField("Username", text: $draft.username)
                        .platformNoAutoCaps()
                    TextField("Lightning address", text: $draft.address)
                        .platformNoAutoCaps()
                    TextField("npub or hex pubkey", text: $draft.npub)
                        .platformNoAutoCaps()
                    TextField("NIP-05", text: $draft.nip05)
                        .platformNoAutoCaps()
                    TextField("Picture URL", text: $draft.picture)
                        .platformNoAutoCaps()
                        .platformURLKeyboard()
                    TextField("Relay hints (comma separated)", text: Binding(
                        get: { draft.relays.joined(separator: ", ") },
                        set: { draft.relays = normalizeRelayList($0.split(separator: ",").map(String.init)) }
                    ))
                        .platformNoAutoCaps()
                        .platformURLKeyboard()
                    TextField("About", text: $draft.about, axis: .vertical)
                        .lineLimit(4, reservesSpace: true)
                }

                if let saveError, !saveError.isEmpty {
                    Section {
                        Text(saveError)
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle(title)
            .platformInlineTitle()
            .toolbar {
                ToolbarItem(placement: PlatformToolbarPlacement.leading) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: PlatformToolbarPlacement.trailing) {
                    Button {
                        Task {
                            saveBusy = true
                            defer { saveBusy = false }
                            let ok = await onSave(draft)
                            if ok {
                                dismiss()
                            } else {
                                saveError = "Unable to save contact."
                            }
                        }
                    } label: {
                        if saveBusy {
                            ProgressView()
                        } else {
                            Text("Save")
                        }
                    }
                    .disabled(saveBusy)
                }
            }
        }
    }
}

private struct ProfileMetadataEditorSheet: View {
    let initialMetadata: TaskifyProfileMetadata
    let profileName: String
    let npub: String
    let onSave: (TaskifyProfileMetadata) async -> Bool

    @Environment(\.dismiss) private var dismiss

    @State private var metadata: TaskifyProfileMetadata
    @State private var saveBusy = false
    @State private var saveError: String?

    init(
        initialMetadata: TaskifyProfileMetadata,
        profileName: String,
        npub: String,
        onSave: @escaping (TaskifyProfileMetadata) async -> Bool
    ) {
        self.initialMetadata = initialMetadata
        self.profileName = profileName
        self.npub = npub
        self.onSave = onSave
        _metadata = State(initialValue: initialMetadata)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack(spacing: 14) {
                        ZStack {
                            Circle()
                                .fill(ThemeColors.accentBlue.opacity(0.14))
                                .frame(width: 54, height: 54)
                            Text(contactInitials(metadata.displayName.isEmpty ? profileName : metadata.displayName))
                                .font(.title3.weight(.semibold))
                                .foregroundStyle(ThemeColors.accentBlue)
                        }

                        VStack(alignment: .leading, spacing: 4) {
                            Text(metadata.displayName.isEmpty ? profileName : metadata.displayName)
                                .font(.headline)
                            Text(npub)
                                .font(.caption.monospaced())
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                    }
                    ShareLink(item: npub) {
                        Label("Share npub", systemImage: "square.and.arrow.up")
                    }
                }

                Section("Profile Metadata") {
                    TextField("Username", text: $metadata.username)
                        .platformNoAutoCaps()
                    TextField("Display name", text: $metadata.displayName)
                    TextField("Lightning address", text: $metadata.lud16)
                        .platformNoAutoCaps()
                    TextField("NIP-05", text: $metadata.nip05)
                        .platformNoAutoCaps()
                    TextField("Picture URL", text: $metadata.picture)
                        .platformNoAutoCaps()
                        .platformURLKeyboard()
                    TextField("About", text: $metadata.about, axis: .vertical)
                        .lineLimit(4, reservesSpace: true)
                }

                if let saveError, !saveError.isEmpty {
                    Section {
                        Text(saveError)
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("My Card")
            .platformInlineTitle()
            .toolbar {
                ToolbarItem(placement: PlatformToolbarPlacement.leading) {
                    Button("Done") { dismiss() }
                }
                ToolbarItem(placement: PlatformToolbarPlacement.trailing) {
                    Button {
                        Task {
                            saveBusy = true
                            defer { saveBusy = false }
                            let ok = await onSave(metadata)
                            if ok {
                                dismiss()
                            } else {
                                saveError = "Unable to publish profile metadata."
                            }
                        }
                    } label: {
                        if saveBusy {
                            ProgressView()
                        } else {
                            Text("Save")
                        }
                    }
                }
            }
        }
    }
}

private struct TaskifyQRCodeView: View {
    let value: String

    private let context = CIContext()
    private let filter = CIFilter.qrCodeGenerator()

    var body: some View {
        if let image = qrImage {
            Image(decorative: image, scale: 1)
                .interpolation(.none)
                .resizable()
                .scaledToFit()
        } else {
            RoundedRectangle(cornerRadius: 20)
                .fill(ThemeColors.surfaceRaised)
                .overlay {
                    Text("QR unavailable")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
        }
    }

    private var qrImage: CGImage? {
        filter.message = Data(value.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage?.transformed(by: CGAffineTransform(scaleX: 12, y: 12)) else { return nil }
        return context.createCGImage(output, from: output.extent)
    }
}
