import SwiftUI
import SwiftData
import TaskifyCore

struct RootView: View {
    @EnvironmentObject private var authVM: AppAuthViewModel
    @EnvironmentObject private var dataController: DataController
    @EnvironmentObject private var settingsManager: SettingsManager
    @Environment(\.modelContext) private var modelContext

    var body: some View {
        switch authVM.state {
        case .signedIn(let profile):
            NativeAppShellView(profile: profile)
                .task {
                    await dataController.bootstrap(profile: profile, modelContext: modelContext)
                }
        case .importing:
            ProgressView("Signing in…")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color.black.opacity(0.02))
        case .error(let message):
            SignInView(errorMessage: message)
        case .signedOut:
            SignInView(errorMessage: nil)
        }
    }
}

struct NativeAppShellView: View {
    @StateObject private var shellVM: AppShellViewModel
    @EnvironmentObject private var dataController: DataController
    @EnvironmentObject private var settingsManager: SettingsManager

    init(profile: TaskifyProfile) {
        _shellVM = StateObject(wrappedValue: AppShellViewModel(profile: profile))
    }

    var body: some View {
        let currentProfile = dataController.currentProfile ?? shellVM.profile
        TabView(selection: Binding(
            get: { shellVM.selectedTab },
            set: { shellVM.select(tab: $0) }
        )) {
            BoardsShellScreen(shellVM: shellVM)
                .tabItem { Label("Boards", systemImage: "square.grid.2x2") }
                .tag(AppShellViewModel.Tab.boards)

            UpcomingShellScreen(profile: currentProfile)
                .tabItem { Label("Upcoming", systemImage: "calendar") }
                .tag(AppShellViewModel.Tab.upcoming)

            ContactsShellScreen(profile: currentProfile)
                .tabItem { Label("Contacts", systemImage: "person.2") }
                .tag(AppShellViewModel.Tab.contacts)

            SettingsShellScreen(profile: currentProfile)
                .tabItem { Label("Settings", systemImage: "gearshape") }
                .tag(AppShellViewModel.Tab.settings)
        }
        .tint(ThemeColors.accent(for: settingsManager.settings.accent))
    }
}
