import SwiftData
import SwiftUI

@main
struct TaskifyApp: App {
    @StateObject private var authVM = AppAuthViewModel()
    @StateObject private var dataController = DataController()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(authVM)
                .environmentObject(dataController)
                .modelContainer(for: [TaskifyTask.self, TaskifyBoard.self, TaskifyCalendarEvent.self])
                .task { await authVM.bootstrap() }
        }
    }
}
