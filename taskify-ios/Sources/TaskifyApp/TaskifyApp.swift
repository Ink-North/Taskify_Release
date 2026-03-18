/// TaskifyApp.swift
/// SwiftUI app entry point — Phase 1 placeholder.
/// Full UI implementation begins in Phase 2.

import SwiftUI
import SwiftData
import TaskifyCore

@main
struct TaskifyApp: App {

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
        .modelContainer(for: [
            TaskifyTask.self,
            TaskifyCalendarEvent.self,
            TaskifyBoard.self,
        ])
    }
}

struct ContentView: View {
    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 72))
                    .foregroundStyle(.tint)
                Text("Taskify")
                    .font(.largeTitle.bold())
                Text("Phase 1 — Foundation")
                    .foregroundStyle(.secondary)
            }
            .navigationTitle("Taskify")
        }
    }
}
