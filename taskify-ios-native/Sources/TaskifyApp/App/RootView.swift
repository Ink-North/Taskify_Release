import SwiftUI
import SwiftData
import TaskifyCore

struct RootView: View {
    @EnvironmentObject private var authVM: AppAuthViewModel
    @EnvironmentObject private var dataController: DataController
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

    init(profile: TaskifyProfile) {
        _shellVM = StateObject(wrappedValue: AppShellViewModel(profile: profile))
    }

    var body: some View {
        TabView(selection: Binding(
            get: { shellVM.selectedTab },
            set: { shellVM.select(tab: $0) }
        )) {
            BoardsShellScreen(shellVM: shellVM)
                .tabItem { Label("Boards", systemImage: "square.grid.2x2") }
                .tag(AppShellViewModel.Tab.boards)

            UpcomingShellScreen(profile: shellVM.profile)
                .tabItem { Label("Upcoming", systemImage: "calendar") }
                .tag(AppShellViewModel.Tab.upcoming)

            SettingsShellScreen(profile: shellVM.profile)
                .tabItem { Label("Settings", systemImage: "gearshape") }
                .tag(AppShellViewModel.Tab.settings)
        }
    }
}
