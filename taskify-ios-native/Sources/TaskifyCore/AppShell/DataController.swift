/// DataController.swift
/// Bridges RelayPool + BoardSyncManager + SwiftData ↔ ViewModels.
///
/// This is the missing wiring layer — the sync engine writes to SwiftData,
/// this controller reads from SwiftData and populates the view models,
/// and writes user edits back through the sync engine to Nostr relays.
///
/// Mirrors the data flow in App.tsx:
///   Nostr relay → decrypt → merge into local store → render
///   UI edit → update local store → encrypt → publish to relays

import CryptoKit
import Foundation
import SwiftData

// MARK: - BoardKeyDerivation (matches boardKeys.ts deriveBoardKeyPair)

/// Derives the deterministic secp256k1 keypair for a board.
/// This is the board's Nostr identity — tasks are published under this key.
public struct BoardKeyInfo {
    public let boardId: String
    public let privateKeyBytes: Data   // 32 bytes
    public let publicKeyHex: String    // 64-char hex (x-only)

    public init(boardId: String) throws {
        self.boardId = boardId
        let label = "taskify-board-nostr-key-v1"
        var material = Data(label.utf8)
        material.append(Data(boardId.utf8))
        let digest = SHA256.hash(data: material)
        self.privateKeyBytes = Data(digest)
        let xOnlyPub = try Secp256k1Helpers.xOnlyPublicKey(from: Data(digest))
        self.publicKeyHex = xOnlyPub.hexString
    }
}

// MARK: - DataController

@MainActor
public final class DataController: ObservableObject {

    // MARK: Published state

    @Published public private(set) var relayConnected: Int = 0
    @Published public private(set) var syncing: Bool = false
    @Published public private(set) var lastError: String?

    // MARK: Dependencies

    private var relayPool: RelayPool?
    private var modelContext: ModelContext?
    private var profile: TaskifyProfile?
    private var activeSubscriptionKey: String?
    private var activeBoardId: String?

    public init() {}

    // MARK: - Bootstrap

    /// Call after auth succeeds. Sets up the relay pool and SwiftData context.
    public func bootstrap(profile: TaskifyProfile, modelContext: ModelContext) async {
        self.profile = profile
        self.modelContext = modelContext

        let pool = RelayPool(relayURLs: profile.relays)
        self.relayPool = pool

        await pool.connect()
        relayConnected = await pool.connectedCount()
    }

    /// Refresh relay connection count.
    public func refreshRelayStatus() async {
        guard let pool = relayPool else { return }
        relayConnected = await pool.connectedCount()
    }

    // MARK: - Board subscription

    /// Subscribe to a board's task events on all connected relays.
    /// Fetches tasks from SwiftData first (local-first), then syncs from relays.
    public func subscribeToBoard(_ boardId: String) async -> [BoardTaskItem] {
        // Cancel previous subscription
        if let prevKey = activeSubscriptionKey, let pool = relayPool {
            await pool.unsubscribe(key: prevKey)
        }
        activeBoardId = boardId
        syncing = true

        // 1. Read from SwiftData immediately (local-first, mirrors PWA IDB render)
        let localTasks = fetchTasksFromStore(boardId: boardId)

        // 2. Start relay subscription in background
        if let pool = relayPool, let ctx = modelContext {
            let bTag = boardTagHash(boardId)
            let coldFetchDays = 30
            let board = fetchOrCreateBoard(boardId: boardId)
            let since: Int
            if let cursor = board.lastSyncAt, cursor > 0 {
                since = max(0, cursor - 300)
            } else {
                since = Int(Date().timeIntervalSince1970) - coldFetchDays * 86400
            }

            let filter: [String: Any] = [
                "kinds": [30301],
                "#b": [bTag],
                "since": since,
            ]

            let key = await pool.subscribe(
                filters: [filter],
                onEvent: { [weak self] event, relayUrl in
                    guard let self else { return }
                    Task { @MainActor in
                        self.handleIncomingTaskEvent(event, boardId: boardId)
                    }
                },
                onEose: { [weak self] _ in
                    Task { @MainActor in
                        self?.syncing = false
                    }
                }
            )
            activeSubscriptionKey = key

            // Absolute timeout
            Task {
                try? await Task.sleep(nanoseconds: 25_000_000_000)
                await MainActor.run { self.syncing = false }
            }
        }

        return localTasks
    }

    /// Unsubscribe from the current board.
    public func unsubscribe() async {
        if let key = activeSubscriptionKey, let pool = relayPool {
            await pool.unsubscribe(key: key)
        }
        activeSubscriptionKey = nil
        activeBoardId = nil
        syncing = false
    }

    // MARK: - Read from SwiftData

    /// Fetch all non-deleted tasks for a board from SwiftData.
    public func fetchTasksFromStore(boardId: String) -> [BoardTaskItem] {
        guard let ctx = modelContext else { return [] }
        let descriptor = FetchDescriptor<TaskifyTask>(
            predicate: #Predicate<TaskifyTask> { t in
                t.boardId == boardId && t.deleted == false
            },
            sortBy: [SortDescriptor(\.createdAt, order: .reverse)]
        )
        guard let tasks = try? ctx.fetch(descriptor) else { return [] }
        return tasks.map { BoardTaskItem.from($0) }
    }

    /// Fetch all non-deleted tasks across all boards that have due dates.
    public func fetchUpcomingTasks(boardIds: [String]) -> [BoardTaskItem] {
        guard let ctx = modelContext else { return [] }
        let descriptor = FetchDescriptor<TaskifyTask>(
            predicate: #Predicate<TaskifyTask> { t in
                t.deleted == false && t.completed == false
            },
            sortBy: [SortDescriptor(\.createdAt, order: .reverse)]
        )
        guard let tasks = try? ctx.fetch(descriptor) else { return [] }
        return tasks
            .filter { boardIds.contains($0.boardId) }
            .map { BoardTaskItem.from($0) }
    }

    // MARK: - Write: Create task

    /// Creates a task locally in SwiftData and publishes to relays.
    public func createTask(from editVM: TaskEditViewModel) async -> BoardTaskItem? {
        guard let ctx = modelContext else { return nil }
        let taskId = UUID().uuidString
        let task = TaskifyTask(
            id: taskId,
            boardId: editVM.location.boardId,
            title: editVM.title.trimmingCharacters(in: .whitespaces),
            completed: false,
            deleted: false,
            createdAt: Int(Date().timeIntervalSince1970)
        )
        applyEditToModel(editVM, task: task)
        ctx.insert(task)
        try? ctx.save()

        // Publish to relays
        await publishTask(task, status: "open")

        return BoardTaskItem.from(task)
    }

    /// Quick-add a task with just a title.
    public func quickAddTask(title: String, boardId: String, columnId: String?) async -> BoardTaskItem? {
        guard let ctx = modelContext else { return nil }
        let task = TaskifyTask(
            id: UUID().uuidString,
            boardId: boardId,
            title: title,
            completed: false,
            deleted: false,
            createdAt: Int(Date().timeIntervalSince1970)
        )
        task.column = columnId
        ctx.insert(task)
        try? ctx.save()

        await publishTask(task, status: "open")
        return BoardTaskItem.from(task)
    }

    // MARK: - Write: Update task

    /// Updates an existing task and publishes the change.
    public func updateTask(taskId: String, from editVM: TaskEditViewModel) async -> BoardTaskItem? {
        guard let ctx = modelContext,
              let task = fetchTaskModel(id: taskId) else { return nil }
        applyEditToModel(editVM, task: task)
        task.lastEditedBy = profile?.npub
        try? ctx.save()

        let status = task.completed ? "done" : (task.deleted ? "deleted" : "open")
        await publishTask(task, status: status)
        return BoardTaskItem.from(task)
    }

    // MARK: - Write: Toggle complete

    /// Toggles a task's completion status and publishes.
    public func toggleComplete(taskId: String) async -> BoardTaskItem? {
        guard let ctx = modelContext,
              let task = fetchTaskModel(id: taskId) else { return nil }
        task.completed.toggle()
        if task.completed {
            task.completedAt = ISO8601DateFormatter().string(from: Date())
            task.completedBy = profile?.npub
        } else {
            task.completedAt = nil
            task.completedBy = nil
        }
        try? ctx.save()

        await publishTask(task, status: task.completed ? "done" : "open")
        return BoardTaskItem.from(task)
    }

    // MARK: - Write: Delete task

    /// Soft-deletes a task and publishes the deletion.
    public func deleteTask(taskId: String) async -> Bool {
        guard let ctx = modelContext,
              let task = fetchTaskModel(id: taskId) else { return false }
        task.deleted = true
        try? ctx.save()

        await publishTask(task, status: "deleted")
        return true
    }

    // MARK: - Write: Toggle subtask

    /// Toggles a subtask's completion within a task.
    public func toggleSubtask(taskId: String, subtaskId: String) async -> BoardTaskItem? {
        guard let ctx = modelContext,
              let task = fetchTaskModel(id: taskId),
              let json = task.subtasksJSON,
              let data = json.data(using: .utf8),
              var subs = try? JSONDecoder().decode([Subtask].self, from: data),
              let idx = subs.firstIndex(where: { $0.id == subtaskId })
        else { return nil }

        subs[idx].completed.toggle()
        if let newData = try? JSONEncoder().encode(subs),
           let newJSON = String(data: newData, encoding: .utf8) {
            task.subtasksJSON = newJSON
        }
        try? ctx.save()

        await publishTask(task, status: task.completed ? "done" : "open")
        return BoardTaskItem.from(task)
    }

    // MARK: - Board management

    /// Creates a new board and adds it to the profile.
    public func createBoard(name: String, kind: String = "lists", columns: [BoardColumn] = []) async -> ProfileBoardEntry? {
        guard let ctx = modelContext, var prof = profile else { return nil }
        let boardId = UUID().uuidString
        let board = TaskifyBoard(id: boardId, name: name, kind: kind)
        if !columns.isEmpty {
            let colData = try? JSONEncoder().encode(columns)
            board.columnsJSON = colData.flatMap { String(data: $0, encoding: .utf8) }
        }
        ctx.insert(board)
        try? ctx.save()

        let entry = ProfileBoardEntry(id: boardId, name: name)
        prof.boards.append(entry)
        profile = prof
        // Save profile update to Keychain
        try? KeychainStore.saveProfile(prof)

        return entry
    }

    /// Joins an existing board by ID (from a share link).
    public func joinBoard(boardId: String, name: String, relays: [String]? = nil) async -> ProfileBoardEntry? {
        guard let ctx = modelContext, var prof = profile else { return nil }

        // Don't re-add if already a member
        guard !prof.boards.contains(where: { $0.id == boardId }) else {
            return prof.boards.first(where: { $0.id == boardId })
        }

        let board = TaskifyBoard(id: boardId, name: name, kind: "lists")
        ctx.insert(board)
        try? ctx.save()

        let entry = ProfileBoardEntry(id: boardId, name: name)
        prof.boards.append(entry)
        profile = prof
        try? KeychainStore.saveProfile(prof)

        // Start syncing this board
        let _ = await subscribeToBoard(boardId)
        return entry
    }

    // MARK: - Internal helpers

    private func fetchTaskModel(id: String) -> TaskifyTask? {
        guard let ctx = modelContext else { return nil }
        let descriptor = FetchDescriptor<TaskifyTask>(
            predicate: #Predicate<TaskifyTask> { t in t.id == id }
        )
        return try? ctx.fetch(descriptor).first
    }

    private func fetchOrCreateBoard(boardId: String) -> TaskifyBoard {
        guard let ctx = modelContext else {
            return TaskifyBoard(id: boardId, name: "Unknown")
        }
        let descriptor = FetchDescriptor<TaskifyBoard>(
            predicate: #Predicate<TaskifyBoard> { b in b.id == boardId }
        )
        if let existing = try? ctx.fetch(descriptor).first {
            return existing
        }
        let board = TaskifyBoard(id: boardId, name: "Board")
        ctx.insert(board)
        try? ctx.save()
        return board
    }

    private func applyEditToModel(_ editVM: TaskEditViewModel, task: TaskifyTask) {
        task.title = editVM.title.trimmingCharacters(in: .whitespaces)
        task.note = editVM.note.isEmpty ? nil : editVM.note
        task.priority = editVM.priority.rawValue == 0 ? nil : editVM.priority.rawValue
        task.dueDateEnabled = editVM.dueDateEnabled
        task.dueTimeEnabled = editVM.dueTimeEnabled
        task.dueTimeZone = editVM.dueTimeEnabled ? editVM.dueTimeZone : nil
        task.dueISO = editVM.computedDueISO ?? ""
        task.column = editVM.location.columnId
        task.subtasksJSON = editVM.subtasksJSONString
        task.recurrenceJSON = editVM.recurrenceJSONString
    }

    private func handleIncomingTaskEvent(_ event: NostrEvent, boardId: String) {
        guard let ctx = modelContext else { return }
        guard let taskId = event.tagValue("d"), !taskId.isEmpty,
              let plaintext = try? decryptTaskPayload(event.content, boardId: boardId),
              let data = plaintext.data(using: .utf8),
              let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let status = event.tagValue("status")
        else { return }

        let descriptor = FetchDescriptor<TaskifyTask>(
            predicate: #Predicate<TaskifyTask> { t in t.id == taskId }
        )
        let existing = try? ctx.fetch(descriptor).first

        if let existing {
            // Clock-protected: skip older events
            if event.created_at < existing.createdAt { return }
            applyPayloadToModel(payload, status: status, task: existing, createdAt: event.created_at, colTag: event.tagValue("col"))
        } else {
            let task = TaskifyTask(id: taskId, boardId: boardId, title: payload["title"] as? String ?? "", completed: status == "done", deleted: status == "deleted", createdAt: event.created_at)
            applyPayloadToModel(payload, status: status, task: task, createdAt: event.created_at, colTag: event.tagValue("col"))
            ctx.insert(task)
        }
        try? ctx.save()
    }

    private func applyPayloadToModel(_ payload: [String: Any], status: String, task: TaskifyTask, createdAt: Int, colTag: String?) {
        task.title = payload["title"] as? String ?? task.title
        task.note = payload["note"] as? String
        task.dueISO = payload["dueISO"] as? String ?? ""
        task.dueDateEnabled = payload["dueDateEnabled"] as? Bool
        task.dueTimeEnabled = payload["dueTimeEnabled"] as? Bool
        task.dueTimeZone = payload["dueTimeZone"] as? String
        task.priority = payload["priority"] as? Int
        task.completed = status == "done"
        task.completedAt = payload["completedAt"] as? String
        task.completedBy = payload["completedBy"] as? String
        task.deleted = status == "deleted"
        task.column = colTag?.isEmpty == false ? colTag : nil
        task.createdAt = createdAt
        task.lastEditedBy = payload["lastEditedBy"] as? String
        task.hiddenUntilISO = payload["hiddenUntilISO"] as? String
        task.streak = payload["streak"] as? Int
        task.longestStreak = payload["longestStreak"] as? Int
        if let rec = payload["recurrence"], !(rec is NSNull) {
            task.recurrenceJSON = (try? String(data: JSONSerialization.data(withJSONObject: rec), encoding: .utf8))
        }
        if let subs = payload["subtasks"], !(subs is NSNull) {
            task.subtasksJSON = (try? String(data: JSONSerialization.data(withJSONObject: subs), encoding: .utf8))
        }
        if let assignees = payload["assignees"], !(assignees is NSNull) {
            task.assigneesJSON = (try? String(data: JSONSerialization.data(withJSONObject: assignees), encoding: .utf8))
        }
    }

    /// Publish a task event to relays. Mirrors SyncEngine.publishTask().
    private func publishTask(_ task: TaskifyTask, status: String) async {
        guard let pool = relayPool, let prof = profile else { return }
        do {
            let boardKeyInfo = try BoardKeyInfo(boardId: task.boardId)
            let payload = buildTaskPayload(task)
            let json = try JSONSerialization.data(withJSONObject: payload)
            let plaintext = String(data: json, encoding: .utf8)!
            let encrypted = try encryptTaskPayload(plaintext, boardId: task.boardId)
            let bTag = boardTagHash(task.boardId)

            let unsigned = UnsignedNostrEvent(
                pubkey: boardKeyInfo.publicKeyHex,
                kind: 30301,
                tags: [["d", task.id], ["b", bTag], ["col", task.column ?? ""], ["status", status]],
                content: encrypted
            )
            let event = try unsigned.sign(privateKeyBytes: boardKeyInfo.privateKeyBytes)
            await pool.publish(event: event)
        } catch {
            lastError = "Publish failed: \(error.localizedDescription)"
        }
    }

    private func buildTaskPayload(_ task: TaskifyTask) -> [String: Any] {
        var dict: [String: Any] = [
            "title": task.title,
            "note": task.note ?? "",
            "dueISO": task.dueISO ?? "",
        ]
        if let p = task.priority { dict["priority"] = p }
        if let d = task.dueDateEnabled { dict["dueDateEnabled"] = d }
        if let d = task.dueTimeEnabled { dict["dueTimeEnabled"] = d }
        if let d = task.dueTimeZone { dict["dueTimeZone"] = d }
        if let d = task.completedAt { dict["completedAt"] = d }
        if let d = task.completedBy { dict["completedBy"] = d }
        if let d = task.hiddenUntilISO { dict["hiddenUntilISO"] = d }
        if let d = task.lastEditedBy { dict["lastEditedBy"] = d }
        if let d = task.streak { dict["streak"] = d }
        if let d = task.longestStreak { dict["longestStreak"] = d }
        dict["recurrence"] = jsonField(task.recurrenceJSON)
        dict["subtasks"] = jsonField(task.subtasksJSON)
        dict["assignees"] = jsonField(task.assigneesJSON)
        dict["documents"] = jsonField(task.documentsJSON)
        return dict
    }

    private func jsonField(_ jsonStr: String?) -> Any {
        guard let s = jsonStr, let data = s.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) else { return NSNull() }
        return obj
    }

    // MARK: - Disconnect

    public func disconnect() async {
        await unsubscribe()
        await relayPool?.disconnect()
        relayPool = nil
    }
}
