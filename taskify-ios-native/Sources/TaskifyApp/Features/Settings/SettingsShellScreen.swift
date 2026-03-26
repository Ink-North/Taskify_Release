import SwiftUI
import TaskifyCore
#if canImport(UserNotifications)
import UserNotifications
#endif

private let settingsWeekdayLabels = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
]

struct SettingsShellScreen: View {
    let profile: TaskifyProfile
    @EnvironmentObject private var authVM: AppAuthViewModel
    @EnvironmentObject private var dataController: DataController
    @EnvironmentObject private var settingsManager: SettingsManager

    @State private var showSignOutConfirm = false
    @State private var showCopyNpub = false
    @State private var showCopyNsec = false
    @State private var showRelayEditor = false
    @State private var showBoardComposer = false
    @State private var managingBoard: ProfileBoardSummary?
    @State private var editingRelays: [String] = []
    @State private var newRelayURL = ""
    @State private var nsecRevealed = false
    @State private var copiedBoardShareId: String?
    @State private var visibleBoardsExpanded = true
    @State private var hiddenBoardsExpanded = false
    @State private var archivedBoardsExpanded = false
    @State private var fileStorageServerDraft = ""
    @State private var fileStorageStatus: String?
    @State private var fileStorageStatusIsError = false
    @State private var pushStatusMessage: String?
    @State private var pushStatusIsError = false
    @State private var notificationPermission: NotificationPermissionState = .notDetermined
    @State private var pushBusy = false

    var body: some View {
        NavigationStack {
            Form {
                profileSection
                viewSection
                launchBoardsSection
                bibleSection
                pushSection
                nostrSection
                boardsSection
                backupSection
                aboutSection
                signOutSection
            }
            .navigationTitle("Settings")
            .platformInlineTitle()
            .task {
                fileStorageServerDraft = settingsManager.settings.fileStorageServer
                await dataController.refreshRelayStatus()
                await refreshNotificationPermissionStatus()
            }
            .onChange(of: settingsManager.settings.fileStorageServer) { _, newValue in
                fileStorageServerDraft = newValue
            }
            .confirmationDialog("Sign Out", isPresented: $showSignOutConfirm) {
                Button("Sign Out", role: .destructive) {
                    settingsManager.saveNow()
                    authVM.signOut()
                }
            } message: {
                Text("You will need your nsec key to sign back in. Make sure it's backed up.")
            }
            .sheet(isPresented: $showRelayEditor) {
                relayEditorSheet
            }
            .sheet(isPresented: $showBoardComposer) {
                CreateBoardSheet()
            }
            .sheet(item: $managingBoard) { board in
                manageBoardSheet(for: board)
            }
        }
    }

    // MARK: - Profile Section

    private var profileSection: some View {
        Section {
            HStack(spacing: 14) {
                ZStack {
                    Circle()
                        .fill(accentColor.opacity(0.15))
                        .frame(width: 52, height: 52)
                    Text(initials(from: profile.name))
                        .font(.title3.bold())
                        .foregroundStyle(accentColor)
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

            LabeledContent("Connected relays") {
                Text("\(dataController.relayConnected)/\(profile.relays.count)")
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(.secondary)
            }

            Button(action: {
                PlatformServices.copyToPasteboard(profile.npub)
                PlatformServices.notificationSuccess()
                showCopyNpub = true
            }) {
                HStack {
                    Label("Copy npub", systemImage: "doc.on.doc")
                    Spacer()
                    if showCopyNpub {
                        Text("Copied!")
                            .font(.caption)
                            .foregroundStyle(.green)
                    }
                }
            }

            DisclosureGroup("Private Key (nsec)") {
                if nsecRevealed {
                    if let nsecValue {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(nsecValue)
                                .font(.system(.caption2, design: .monospaced))
                                .foregroundStyle(.secondary)
                                .textSelection(.enabled)

                            Button(action: {
                                PlatformServices.copyToPasteboard(nsecValue)
                                PlatformServices.notificationSuccess()
                                showCopyNsec = true
                            }) {
                                HStack {
                                    Image(systemName: "doc.on.doc")
                                    Text(showCopyNsec ? "Copied!" : "Copy nsec")
                                        .font(.caption)
                                }
                            }
                            .buttonStyle(.bordered)
                            .controlSize(.small)
                        }
                    } else {
                        Text("Unable to derive the active account nsec.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                } else {
                    Button("Reveal Key") {
                        nsecRevealed = true
                    }
                    .foregroundStyle(.orange)
                }
            }
        } header: {
            Text("Profile")
        } footer: {
            Text("Keep your nsec safe. It is the same recovery format used by the Taskify PWA.")
        }
    }

    // MARK: - View Section

    private var viewSection: some View {
        Section {
            Picker("Theme", selection: $settingsManager.settings.appearance) {
                ForEach(AppearanceMode.allCases) { mode in
                    Text(mode.label).tag(mode)
                }
            }

            Picker("Accent Color", selection: $settingsManager.settings.accent) {
                ForEach(accentChoices) { choice in
                    HStack {
                        Circle()
                            .fill(ThemeColors.accent(for: choice))
                            .frame(width: 14, height: 14)
                        Text(choice.label)
                    }
                    .tag(choice)
                }
            }

            Picker("Week Starts On", selection: $settingsManager.settings.weekStart) {
                Text("Sunday").tag(0)
                Text("Monday").tag(1)
                Text("Saturday").tag(6)
            }

            Picker("New Tasks Appear", selection: $settingsManager.settings.newTaskPosition) {
                ForEach(NewTaskPosition.allCases) { pos in
                    Text(pos.label).tag(pos)
                }
            }

            Toggle(isOn: $settingsManager.settings.completedTab) {
                Label("Completed Tab", systemImage: "checkmark.circle")
            }

            Toggle(isOn: $settingsManager.settings.streaksEnabled) {
                Label("Streak Badges", systemImage: "flame")
            }

            Toggle(isOn: $settingsManager.settings.hideCompletedSubtasks) {
                Label("Hide Completed Subtasks", systemImage: "eye.slash")
            }

            Toggle(isOn: $settingsManager.settings.showFullWeekRecurring) {
                Label("Show Full Week Recurring", systemImage: "calendar.badge.clock")
            }
        } header: {
            Text("View")
        } footer: {
            Text("Theme, accent, new-task placement, completed-tab behavior, streak badges, and subtask visibility apply immediately. Week-based recurrence settings are stored for parity with the PWA.")
        }
    }

    // MARK: - Launch Boards Section

    private var launchBoardsSection: some View {
        Section {
            if visibleBoards.isEmpty {
                Text("Create or join a visible board to set daily launch targets.")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(Array(settingsWeekdayLabels.enumerated()), id: \.offset) { index, label in
                    Picker(label, selection: startBoardBinding(for: index)) {
                        Text("Default (first visible)").tag("")
                        ForEach(visibleBoards) { board in
                            Text(board.name).tag(board.id)
                        }
                    }
                }
            }
        } header: {
            Text("Board On App Start")
        } footer: {
            Text("Taskify can choose a different default board depending on the day, matching the PWA's daily start-board setting.")
        }
    }

    // MARK: - Bible Section

    private var bibleSection: some View {
        Section {
            Toggle(isOn: $settingsManager.settings.bibleTrackerEnabled) {
                Label("Bible Tracker", systemImage: "book.closed")
            }

            Toggle(isOn: scriptureMemoryBinding) {
                Label("Scripture Memory", systemImage: "bookmark")
            }

            if settingsManager.settings.scriptureMemoryEnabled {
                Picker("Review Board", selection: scriptureMemoryBoardSelection) {
                    Text("Select a board…").tag("")
                    ForEach(scriptureMemoryBoards) { board in
                        Text(board.name).tag(board.id)
                    }
                }

                Picker("Review Frequency", selection: $settingsManager.settings.scriptureMemoryFrequency) {
                    ForEach(ScriptureMemoryFrequency.allCases) { frequency in
                        Text(frequency.label).tag(frequency)
                    }
                }

                Picker("Sort Scriptures By", selection: $settingsManager.settings.scriptureMemorySort) {
                    ForEach(ScriptureMemorySort.allCases) { sort in
                        Text(sort.label).tag(sort)
                    }
                }

                Text(settingsManager.settings.scriptureMemoryFrequency.description)
                    .font(.caption)
                    .foregroundStyle(.secondary)

                if scriptureMemoryBoards.isEmpty {
                    Text("Create a visible board to receive scripture memory review tasks.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            Toggle(isOn: $settingsManager.settings.fastingRemindersEnabled) {
                Label("Fasting Reminders", systemImage: "calendar.badge.plus")
            }

            if settingsManager.settings.fastingRemindersEnabled {
                Picker("Schedule Mode", selection: $settingsManager.settings.fastingRemindersMode) {
                    ForEach(FastingRemindersMode.allCases) { mode in
                        Text(mode.label).tag(mode)
                    }
                }

                Stepper(
                    value: fastingRemindersPerMonthBinding,
                    in: 1...fastingRemindersUpperBound
                ) {
                    let label = settingsManager.settings.fastingRemindersMode == .random ? "Days Per Month" : "Times Per Month"
                    LabeledContent(label) {
                        Text("\(settingsManager.settings.fastingRemindersPerMonth)")
                            .font(.subheadline.monospacedDigit())
                    }
                }

                if settingsManager.settings.fastingRemindersMode == .weekday {
                    Picker("Day of Week", selection: $settingsManager.settings.fastingRemindersWeekday) {
                        ForEach(Array(settingsWeekdayLabels.enumerated()), id: \.offset) { index, label in
                            Text(label).tag(index)
                        }
                    }
                }
            }
        } header: {
            Text("Bible")
        } footer: {
            Text("These preferences mirror the PWA contract now. Native scripture-memory task generation and fasting reminder automation are still pending.")
        }
    }

    // MARK: - Push Section

    private var pushSection: some View {
        Section {
            LabeledContent("Permission") {
                Text(notificationPermission.label)
                    .foregroundStyle(notificationPermission == .granted ? .green : .secondary)
            }

            if notificationPermission == .granted {
                Toggle(isOn: pushEnabledBinding) {
                    Label("Push Notifications", systemImage: "bell.badge")
                }
            } else {
                Button(action: {
                    Task {
                        await requestNotificationPermission()
                    }
                }) {
                    Label(pushBusy ? "Requesting Permission…" : "Allow Notifications", systemImage: "bell.badge")
                }
                .disabled(pushBusy)
            }

            if let pushStatusMessage, !pushStatusMessage.isEmpty {
                Text(pushStatusMessage)
                    .font(.footnote)
                    .foregroundStyle(pushStatusIsError ? .red : .secondary)
            }
        } header: {
            Text("Push Notifications")
        } footer: {
            Text("OS notification permission is wired now and stored in the same settings payload shape as the PWA. Device registration and reminder delivery transport are still pending in the native app.")
        }
    }

    // MARK: - Nostr Section

    private var nostrSection: some View {
        Section {
            if let lastError = dataController.lastError, !lastError.isEmpty {
                Text(lastError)
                    .font(.footnote)
                    .foregroundStyle(.red)
            }

            LabeledContent("Configured relays") {
                Text("\(profile.relays.count)")
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(.secondary)
            }

            LabeledContent("Connected now") {
                Text("\(dataController.relayConnected)")
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(dataController.relayConnected > 0 ? .green : .orange)
            }

            if profile.relays.isEmpty {
                Text("No relays configured.")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(profile.relays, id: \.self) { relay in
                    HStack(spacing: 8) {
                        Circle()
                            .fill(dataController.relayConnected > 0 ? .green : .orange)
                            .frame(width: 8, height: 8)
                        Text(relay)
                            .font(.subheadline)
                            .lineLimit(1)
                    }
                }
            }

            Button(action: {
                editingRelays = profile.relays
                showRelayEditor = true
            }) {
                Label("Manage Relays", systemImage: "slider.horizontal.3")
            }

            Button(action: {
                Task {
                    await dataController.refreshRelayStatus()
                }
            }) {
                Label("Refresh Relay Status", systemImage: "arrow.clockwise")
            }

            LabeledContent("File Storage Server") {
                Text(settingsManager.settings.fileStorageServer)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            VStack(alignment: .leading, spacing: 8) {
                TextField("https://nostr.build", text: $fileStorageServerDraft)
                    .platformNoAutoCaps()
                    .platformURLKeyboard()
                    .onSubmit(saveFileStorageServer)

                HStack {
                    Button("Save File Server", action: saveFileStorageServer)
                        .disabled(fileStorageServerDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                    Button("Reset") {
                        settingsManager.settings.fileStorageServer = UserSettings.defaultFileStorageServer
                        fileStorageServerDraft = UserSettings.defaultFileStorageServer
                        fileStorageStatus = "File-storage preference reset."
                        fileStorageStatusIsError = false
                    }
                }

                if let fileStorageStatus, !fileStorageStatus.isEmpty {
                    Text(fileStorageStatus)
                        .font(.footnote)
                        .foregroundStyle(fileStorageStatusIsError ? .red : .secondary)
                }
            }
        } header: {
            Text("Nostr")
        } footer: {
            Text("Relay URLs drive Taskify sharing, board publishing, and sync. The native app uses the same relay list and board relay-hint contract as the PWA/runtime. File-storage server preference is persisted now for future NIP-96 parity.")
        }
    }

    // MARK: - Boards Section

    private var boardsSection: some View {
        Section {
            Button(action: { showBoardComposer = true }) {
                Label("Create or Join Board", systemImage: "plus.circle.fill")
            }

            if boardSummaries.isEmpty {
                HStack {
                    Image(systemName: "tray")
                        .foregroundStyle(.secondary)
                    Text("No boards on this profile yet")
                        .foregroundStyle(.secondary)
                }
            } else {
                boardGroup(
                    title: "Visible Boards",
                    boards: visibleBoards,
                    isExpanded: $visibleBoardsExpanded
                )

                if hiddenBoards.isEmpty == false {
                    boardGroup(
                        title: "Hidden Boards",
                        boards: hiddenBoards,
                        isExpanded: $hiddenBoardsExpanded
                    )
                }

                if archivedBoards.isEmpty == false {
                    boardGroup(
                        title: "Archived Boards",
                        boards: archivedBoards,
                        isExpanded: $archivedBoardsExpanded
                    )
                }
            }
        } header: {
            Text("Boards")
        } footer: {
            Text("Board share payloads use the same Taskify envelope as the PWA, so joining and re-sharing remain cross-compatible.")
        }
    }

    // MARK: - Backup Section

    private var backupSection: some View {
        Section {
            Toggle(isOn: $settingsManager.settings.nostrBackupEnabled) {
                Label("Encrypted Nostr Backup", systemImage: "icloud.and.arrow.up")
            }

            Toggle(isOn: $settingsManager.settings.cloudBackupsEnabled) {
                Label("Cloud Backup", systemImage: "cloud")
            }
        } header: {
            Text("Backup & Sync")
        } footer: {
            Text("These backup preferences are stored now for parity with the PWA settings contract. Native upload and restore transport are still pending, so these toggles do not yet move data off-device.")
        }
    }

    // MARK: - About Section

    private var aboutSection: some View {
        Section {
            HStack {
                Text("Version")
                Spacer()
                Text(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0.0")
                    .foregroundStyle(.secondary)
            }
            HStack {
                Text("Platform")
                Spacer()
                Text("iOS Native")
                    .foregroundStyle(.secondary)
            }
            HStack {
                Text("Build")
                Spacer()
                Text(Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1")
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
                    if editingRelays.isEmpty {
                        Text("No relays configured")
                            .foregroundStyle(.secondary)
                    }
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
                } header: {
                    Text("Current Relays")
                }

                Section {
                    HStack {
                        TextField("wss://relay.example.com", text: $newRelayURL)
                            .platformNoAutoCaps()
                            .platformURLKeyboard()
                            .onSubmit { addRelay() }
                        Button("Add") { addRelay() }
                            .disabled(newRelayURL.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                } header: {
                    Text("Add Relay")
                }

                Section {
                    Button("Reset to Defaults") {
                        editingRelays = AuthSessionManager.defaultRelayPreset
                    }
                }
            }
            .navigationTitle("Manage Relays")
            .platformInlineTitle()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { showRelayEditor = false }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task {
                            await dataController.updateRelays(editingRelays)
                        }
                        showRelayEditor = false
                    }
                    .bold()
                }
            }
        }
    }

    // MARK: - Helpers

    private var accentColor: Color {
        ThemeColors.accent(for: settingsManager.settings.accent)
    }

    private var nsecValue: String? {
        try? NostrIdentityService.deriveNsec(fromSecretKeyHex: profile.nsecHex)
    }

    private var truncatedNpub: String {
        let npub = profile.npub
        guard npub.count > 20 else { return npub }
        return String(npub.prefix(12)) + "..." + String(npub.suffix(8))
    }

    private var boardSummaries: [ProfileBoardSummary] {
        dataController.profileBoardSummaries()
    }

    private var visibleBoards: [ProfileBoardSummary] {
        boardSummaries.filter { !$0.archived && !$0.hidden }
    }

    private var hiddenBoards: [ProfileBoardSummary] {
        boardSummaries.filter { $0.hidden && !$0.archived }
    }

    private var archivedBoards: [ProfileBoardSummary] {
        boardSummaries.filter(\.archived)
    }

    private var accentChoices: [AccentChoice] {
        settingsManager.settings.accent == .background
            ? AccentChoice.allCases
            : AccentChoice.allCases.filter { $0 != .background }
    }

    private var scriptureMemoryBoards: [ProfileBoardSummary] {
        visibleBoards
    }

    private var fastingRemindersUpperBound: Int {
        settingsManager.settings.fastingRemindersMode == .random ? 31 : 5
    }

    private var scriptureMemoryBinding: Binding<Bool> {
        Binding(
            get: { settingsManager.settings.scriptureMemoryEnabled },
            set: { newValue in
                settingsManager.settings.bibleTrackerEnabled = settingsManager.settings.bibleTrackerEnabled || newValue
                settingsManager.settings.scriptureMemoryEnabled = newValue
                guard newValue else { return }
                if settingsManager.settings.scriptureMemoryBoardId == nil {
                    settingsManager.settings.scriptureMemoryBoardId = scriptureMemoryBoards.first?.id
                }
            }
        )
    }

    private var scriptureMemoryBoardSelection: Binding<String> {
        Binding(
            get: { settingsManager.settings.scriptureMemoryBoardId ?? "" },
            set: { newValue in
                settingsManager.settings.scriptureMemoryBoardId = newValue.isEmpty ? nil : newValue
            }
        )
    }

    private var fastingRemindersPerMonthBinding: Binding<Int> {
        Binding(
            get: { settingsManager.settings.fastingRemindersPerMonth },
            set: { newValue in
                settingsManager.settings.fastingRemindersPerMonth = min(fastingRemindersUpperBound, max(1, newValue))
            }
        )
    }

    private var pushEnabledBinding: Binding<Bool> {
        Binding(
            get: { settingsManager.settings.pushNotifications.enabled },
            set: { newValue in
                var next = settingsManager.settings.pushNotifications
                next.enabled = newValue
                next.platform = .ios
                next.permission = notificationPermission
                settingsManager.settings.pushNotifications = next
                pushStatusMessage = newValue ? "Push preference saved for this device." : nil
                pushStatusIsError = false
            }
        )
    }

    private func initials(from name: String) -> String {
        let words = name.split(separator: " ").prefix(2)
        let value = words.map { String($0.prefix(1)).uppercased() }.joined()
        return value.isEmpty ? "T" : value
    }

    private func addRelay() {
        var url = newRelayURL.trimmingCharacters(in: .whitespaces)
        guard !url.isEmpty else { return }
        if !url.hasPrefix("wss://") && !url.hasPrefix("ws://") {
            url = "wss://" + url
        }
        guard !editingRelays.contains(url) else { return }
        editingRelays.append(url)
        newRelayURL = ""
    }

    private func saveFileStorageServer() {
        let trimmed = fileStorageServerDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            fileStorageStatus = "Enter a valid file-storage server URL."
            fileStorageStatusIsError = true
            return
        }
        guard let normalized = UserSettings.normalizeFileStorageServer(trimmed) else {
            fileStorageStatus = "Enter a valid file-storage server URL."
            fileStorageStatusIsError = true
            return
        }
        settingsManager.settings.fileStorageServer = normalized
        fileStorageServerDraft = normalized
        fileStorageStatus = "File-storage preference saved."
        fileStorageStatusIsError = false
    }

    @MainActor
    private func refreshNotificationPermissionStatus() async {
        #if canImport(UserNotifications)
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        let permission = NotificationPermissionState(settings.authorizationStatus)
        notificationPermission = permission
        var next = settingsManager.settings.pushNotifications
        next.platform = .ios
        next.permission = permission
        if permission != .granted {
            next.enabled = false
        }
        settingsManager.settings.pushNotifications = next
        #else
        notificationPermission = .notDetermined
        #endif
    }

    @MainActor
    private func requestNotificationPermission() async {
        #if canImport(UserNotifications)
        pushBusy = true
        defer { pushBusy = false }

        do {
            let granted = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound])
            await refreshNotificationPermissionStatus()
            pushStatusMessage = granted
                ? "Notifications are allowed on this device."
                : "Permission was not granted. You can enable notifications later in system settings."
            pushStatusIsError = !granted
        } catch {
            pushStatusMessage = error.localizedDescription
            pushStatusIsError = true
        }
        #else
        pushStatusMessage = "Notification permissions are unavailable on this platform build."
        pushStatusIsError = true
        #endif
    }

    private func startBoardBinding(for weekday: Int) -> Binding<String> {
        Binding(
            get: { settingsManager.settings.startBoardByDay[weekday] ?? "" },
            set: { newValue in
                var next = settingsManager.settings.startBoardByDay
                if newValue.isEmpty {
                    next.removeValue(forKey: weekday)
                } else {
                    next[weekday] = newValue
                }
                settingsManager.settings.startBoardByDay = next
            }
        )
    }

    @ViewBuilder
    private func boardGroup(
        title: String,
        boards: [ProfileBoardSummary],
        isExpanded: Binding<Bool>
    ) -> some View {
        DisclosureGroup("\(title) (\(boards.count))", isExpanded: isExpanded) {
            ForEach(boards) { board in
                boardRow(board)
                if board.id != boards.last?.id {
                    Divider()
                }
            }
            .padding(.vertical, 4)
        }
    }

    private func boardRow(_ board: ProfileBoardSummary) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 10) {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 8) {
                        Image(systemName: "square.grid.2x2")
                            .foregroundStyle(accentColor)
                        Text(board.name)
                            .font(.subheadline.weight(.semibold))
                    }

                    Text(board.id)
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)

                    Text(boardMetaDescription(board))
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }

                Spacer(minLength: 0)
            }

            HStack(spacing: 12) {
                Button("Manage") {
                    managingBoard = board
                }

                Button(copiedBoardShareId == board.id ? "Copied" : "Copy Share") {
                    PlatformServices.copyToPasteboard(boardSharePayload(for: board))
                    PlatformServices.notificationSuccess()
                    copiedBoardShareId = board.id
                }

                ShareLink(item: boardSharePayload(for: board)) {
                    Label("Share", systemImage: "square.and.arrow.up")
                }
            }
            .font(.caption.weight(.medium))
        }
    }

    @ViewBuilder
    private func manageBoardSheet(for board: ProfileBoardSummary) -> some View {
        let settings = dataController.boardSettings(boardId: board.id)
            ?? BoardSettingsSnapshot(
                id: board.id,
                name: board.name,
                kind: dataController.boardKind(boardId: board.id) ?? board.kind,
                columns: dataController.boardColumns(boardId: board.id),
                relayHints: board.relayHints
            )

        ManageBoardView(
            settings: settings,
            availableCompoundBoards: dataController.availableCompoundBoards(excluding: board.id)
        )
    }

    private func boardSharePayload(for board: ProfileBoardSummary) -> String {
        dataController.boardShareEnvelope(boardId: board.id)
            ?? BoardShareContract.buildEnvelopeString(
                boardId: board.id,
                boardName: board.name,
                relays: profile.relays + board.relayHints
            )
    }

    private func boardMetaDescription(_ board: ProfileBoardSummary) -> String {
        let boardType = boardKindLabel(board.kind)
        if board.relayHints.isEmpty {
            return boardType
        }
        let relayCount = board.relayHints.count
        return "\(boardType) · \(relayCount) board relay hint\(relayCount == 1 ? "" : "s")"
    }

    private func boardKindLabel(_ kind: String) -> String {
        switch kind {
        case "lists":
            return "Lists"
        case "compound":
            return "Compound"
        case "week":
            return "Week"
        default:
            return kind.capitalized
        }
    }
}

#if canImport(UserNotifications)
private extension NotificationPermissionState {
    init(_ status: UNAuthorizationStatus) {
        switch status {
        case .authorized, .provisional, .ephemeral:
            self = .granted
        case .denied:
            self = .denied
        case .notDetermined:
            self = .notDetermined
        @unknown default:
            self = .notDetermined
        }
    }
}
#endif
