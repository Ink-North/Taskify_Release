import SwiftUI

@main
struct TaskifyApp: App {
    @StateObject private var authVM = AppAuthViewModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(authVM)
                .task { await authVM.bootstrap() }
        }
    }
}
