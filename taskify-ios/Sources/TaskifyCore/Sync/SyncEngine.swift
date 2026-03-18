/// SyncEngine.swift
/// Cursor-based incremental sync engine for Taskify boards.
///
/// Mirrors listTasks() logic from taskify-cli/src/nostrRuntime.ts:
/// - First run: 30-day cold fetch
/// - Subsequent runs: since=(lastSyncAt - 300s) incremental fetch
/// - Merge: latest relay event created_at per task ID wins
/// - Deleted tasks are tracked and excluded from visible results

import Foundation
import SwiftData

// MARK: - SyncEngine

@MainActor
public final class SyncEngine: ObservableObject {

    @Published public private(set) var syncState: SyncState = .idle
    @Published public private(set) var lastError: Error?

    private let relayPool: RelayPool
    private let modelContext: ModelContext

    private let coldFetchDays = 30
    private let cursorLookbackSecs = 300  // 5 min buffer for clock skew
    private let hardTimeoutMs = 12_000
    private let inactivityMs = 3_000
    private let cursorTimeoutMs = 5_000

    public init(relayPool: RelayPool, modelContext: ModelContext) {
        self.relayPool = relayPool
        self.modelContext = modelContext
    }

    // MARK: - Sync a board

    /// Fetches and merges task events for a board from all connected relays.
    /// Call this on app launch, pull-to-refresh, or background push.
    public func syncBoard(_ board: TaskifyBoard) async throws {
        syncState = .syncing(boardId: board.id)

        let since: Int
        if let cursor = board.lastSyncAt, cursor > 0 {
            since = max(0, cursor - cursorLookbackSecs)
        } else {
            since = Int(Date().timeIntervalSince1970) - coldFetchDays * 86400
        }

        let isCursor = board.lastSyncAt != nil
        let timeout = isCursor ? cursorTimeoutMs : hardTimeoutMs
        let inactivity = isCursor ? 1_000 : inactivityMs

        let events = try await fetchBoardEvents(
            boardId: board.id,
            since: since,
            hardTimeoutMs: timeout,
            inactivityMs: inactivity
        )

        try await mergeTaskEvents(events, board: board)
        syncState = .idle
    }

    /// Fetches calendar events for a board.
    public func syncCalendarEvents(_ board: TaskifyBoard) async throws {
        let events = try await fetchCalendarEvents(boardId: board.id)
        try await mergeCalendarEvents(events, board: board)
    }

    // MARK: - Fetch helpers

    private func fetchBoardEvents(
        boardId: String,
        since: Int,
        hardTimeoutMs: Int,
        inactivityMs: Int
    ) async throws -> [NostrEvent] {
        let bTag = boardTagHash(boardId)
        var filter: [String: Any] = [
            "kinds": [TaskifyEventKind.task.rawValue],
            "#b": [bTag],
            "since": since,
        ]

        let subId = "sync-\(boardId.prefix(8))-\(Int(Date().timeIntervalSince1970))"
        await relayPool.subscribe(id: subId, filters: [filter])
        defer { Task { await relayPool.unsubscribe(id: subId) } }

        var collected: [NostrEvent] = []
        var maxCreatedAt = 0

        let stream = await relayPool.waitForEOSE(
            subscriptionId: subId,
            relayCount: await relayPool.connectedRelayCount(),
            inactivityMs: inactivityMs,
            hardTimeoutMs: hardTimeoutMs
        )

        for await msg in stream {
            if case .event(_, let event) = msg {
                if event.kind == TaskifyEventKind.task.rawValue {
                    let bTagMatch = event.tagValues("b").contains(bTag)
                    if bTagMatch {
                        collected.append(event)
                        if event.created_at > maxCreatedAt { maxCreatedAt = event.created_at }
                    }
                }
            }
        }

        return collected
    }

    private func fetchCalendarEvents(boardId: String) async throws -> [NostrEvent] {
        let bTag = boardTagHash(boardId)
        let filter: [String: Any] = [
            "kinds": [TaskifyEventKind.calendarEvent.rawValue, TaskifyEventKind.calendarView.rawValue],
            "#b": [bTag],
            "limit": 500,
        ]

        let subId = "cal-\(boardId.prefix(8))-\(Int(Date().timeIntervalSince1970))"
        await relayPool.subscribe(id: subId, filters: [filter])
        defer { Task { await relayPool.unsubscribe(id: subId) } }

        var collected: [NostrEvent] = []
        let stream = await relayPool.waitForEOSE(
            subscriptionId: subId,
            relayCount: await relayPool.connectedRelayCount(),
            inactivityMs: 3_000,
            hardTimeoutMs: 12_000
        )
        for await msg in stream {
            if case .event(_, let event) = msg { collected.append(event) }
        }
        return collected
    }

    // MARK: - Merge

    private func mergeTaskEvents(_ events: [NostrEvent], board: TaskifyBoard) async throws {
        var maxCreatedAt = board.lastSyncAt ?? 0

        // Fetch existing tasks for this board from SwiftData
        let boardId = board.id
        let descriptor = FetchDescriptor<TaskifyTask>(
            predicate: #Predicate { $0.boardId == boardId }
        )
        var existingById: [String: TaskifyTask] = [:]
        for task in (try? modelContext.fetch(descriptor)) ?? [] {
            existingById[task.id] = task
        }

        // Decrypt and parse incoming events
        for event in events {
            guard let taskId = event.tagValue("d"), !taskId.isEmpty else { continue }
            guard let status = event.tagValue("status") else { continue }

            // Decrypt content
            guard let plaintext = try? decryptTaskPayload(event.content, boardId: boardId),
                  let data = plaintext.data(using: .utf8),
                  let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            else { continue }

            let incoming = parseTaskPayload(
                payload: payload,
                id: taskId,
                boardId: boardId,
                boardName: board.name,
                status: status,
                eventCreatedAt: event.created_at,
                colTag: event.tagValue("col")
            )

            if event.created_at > maxCreatedAt { maxCreatedAt = event.created_at }

            // Merge: latest event wins
            if let existing = existingById[taskId] {
                if incoming.createdAt >= existing.createdAt {
                    applyTaskUpdate(existing, from: incoming)
                }
            } else {
                modelContext.insert(incoming)
                existingById[taskId] = incoming
            }
        }

        // Advance cursor
        if maxCreatedAt > 0 { board.lastSyncAt = maxCreatedAt }
        try modelContext.save()
    }

    private func mergeCalendarEvents(_ events: [NostrEvent], board: TaskifyBoard) async throws {
        let boardId = board.id
        let descriptor = FetchDescriptor<TaskifyCalendarEvent>(
            predicate: #Predicate { $0.boardId == boardId }
        )
        var existingById: [String: TaskifyCalendarEvent] = [:]
        for evt in (try? modelContext.fetch(descriptor)) ?? [] {
            existingById[evt.id] = evt
        }

        for event in events {
            guard let eventId = event.tagValue("d"), !eventId.isEmpty else { continue }
            guard let status = event.tagValue("status") else { continue }

            guard let payloadRaw = try? decryptCalendarPayload(event.content, boardId: boardId),
                  let payload = payloadRaw as? [String: Any]
            else { continue }

            let incoming = parseCalendarPayload(
                payload: payload,
                id: eventId,
                boardId: boardId,
                boardName: board.name,
                status: status,
                eventCreatedAt: event.created_at,
                colTag: event.tagValue("col")
            )

            if let existing = existingById[eventId] {
                if incoming.createdAt >= existing.createdAt {
                    applyCalendarUpdate(existing, from: incoming)
                }
            } else {
                modelContext.insert(incoming)
                existingById[eventId] = incoming
            }
        }

        try modelContext.save()
    }

    // MARK: - Parsers

    private func parseTaskPayload(
        payload: [String: Any],
        id: String,
        boardId: String,
        boardName: String?,
        status: String,
        eventCreatedAt: Int,
        colTag: String?
    ) -> TaskifyTask {
        let task = TaskifyTask(
            id: id,
            boardId: boardId,
            title: payload["title"] as? String ?? "",
            completed: status == "done",
            deleted: status == "deleted",
            createdAt: eventCreatedAt
        )
        task.boardName = boardName
        task.note = payload["note"] as? String
        task.dueISO = payload["dueISO"] as? String ?? ""
        task.dueDateEnabled = payload["dueDateEnabled"] as? Bool
        task.dueTimeEnabled = payload["dueTimeEnabled"] as? Bool
        task.dueTimeZone = payload["dueTimeZone"] as? String
        task.priority = payload["priority"] as? Int
        task.completedAt = payload["completedAt"] as? String
        task.completedBy = payload["completedBy"] as? String
        task.column = colTag?.isEmpty == false ? colTag : nil
        task.createdBy = payload["createdBy"] as? String
        task.lastEditedBy = payload["lastEditedBy"] as? String
        task.inboxItem = payload["inboxItem"] as? Bool
        task.hiddenUntilISO = payload["hiddenUntilISO"] as? String
        task.streak = payload["streak"] as? Int
        task.longestStreak = payload["longestStreak"] as? Int
        task.seriesId = payload["seriesId"] as? String
        if let rec = payload["recurrence"], !(rec is NSNull) {
            task.recurrenceJSON = try? String(data: JSONSerialization.data(withJSONObject: rec), encoding: .utf8)
        }
        if let subtasks = payload["subtasks"], !(subtasks is NSNull) {
            task.subtasksJSON = try? String(data: JSONSerialization.data(withJSONObject: subtasks), encoding: .utf8)
        }
        if let assignees = payload["assignees"], !(assignees is NSNull) {
            task.assigneesJSON = try? String(data: JSONSerialization.data(withJSONObject: assignees), encoding: .utf8)
        }
        if let docs = payload["documents"], !(docs is NSNull) {
            task.documentsJSON = try? String(data: JSONSerialization.data(withJSONObject: docs), encoding: .utf8)
        }
        if let images = payload["images"], !(images is NSNull) {
            task.imagesJSON = try? String(data: JSONSerialization.data(withJSONObject: images), encoding: .utf8)
        }
        return task
    }

    private func parseCalendarPayload(
        payload: [String: Any],
        id: String,
        boardId: String,
        boardName: String?,
        status: String,
        eventCreatedAt: Int,
        colTag: String?
    ) -> TaskifyCalendarEvent {
        let evt = TaskifyCalendarEvent(
            id: id,
            boardId: boardId,
            title: payload["title"] as? String ?? "",
            kind: payload["kind"] as? String ?? "date",
            createdAt: eventCreatedAt
        )
        evt.boardName = boardName
        evt.startDate = payload["startDate"] as? String
        evt.endDate = payload["endDate"] as? String
        evt.startISO = payload["startISO"] as? String
        evt.endISO = payload["endISO"] as? String
        evt.startTzid = payload["startTzid"] as? String
        evt.endTzid = payload["endTzid"] as? String
        evt.eventDescription = payload["description"] as? String
        evt.columnId = colTag?.isEmpty == false ? colTag : nil
        evt.deleted = status == "deleted"
        if let rec = payload["recurrence"], !(rec is NSNull) {
            evt.recurrenceJSON = try? String(data: JSONSerialization.data(withJSONObject: rec), encoding: .utf8)
        }
        if let parts = payload["participants"], !(parts is NSNull) {
            evt.participantsJSON = try? String(data: JSONSerialization.data(withJSONObject: parts), encoding: .utf8)
        }
        if let docs = payload["documents"], !(docs is NSNull) {
            evt.documentsJSON = try? String(data: JSONSerialization.data(withJSONObject: docs), encoding: .utf8)
        }
        return evt
    }

    private func applyTaskUpdate(_ existing: TaskifyTask, from new: TaskifyTask) {
        existing.title = new.title
        existing.note = new.note
        existing.dueISO = new.dueISO
        existing.dueDateEnabled = new.dueDateEnabled
        existing.dueTimeEnabled = new.dueTimeEnabled
        existing.dueTimeZone = new.dueTimeZone
        existing.priority = new.priority
        existing.completed = new.completed
        existing.completedAt = new.completedAt
        existing.completedBy = new.completedBy
        existing.deleted = new.deleted
        existing.column = new.column
        existing.createdAt = new.createdAt
        existing.lastEditedBy = new.lastEditedBy
        existing.inboxItem = new.inboxItem
        existing.hiddenUntilISO = new.hiddenUntilISO
        existing.streak = new.streak
        existing.longestStreak = new.longestStreak
        existing.recurrenceJSON = new.recurrenceJSON
        existing.subtasksJSON = new.subtasksJSON
        existing.assigneesJSON = new.assigneesJSON
        existing.documentsJSON = new.documentsJSON
        existing.imagesJSON = new.imagesJSON
    }

    private func applyCalendarUpdate(_ existing: TaskifyCalendarEvent, from new: TaskifyCalendarEvent) {
        existing.title = new.title
        existing.kind = new.kind
        existing.startDate = new.startDate
        existing.endDate = new.endDate
        existing.startISO = new.startISO
        existing.endISO = new.endISO
        existing.startTzid = new.startTzid
        existing.endTzid = new.endTzid
        existing.eventDescription = new.eventDescription
        existing.columnId = new.columnId
        existing.deleted = new.deleted
        existing.createdAt = new.createdAt
        existing.recurrenceJSON = new.recurrenceJSON
        existing.participantsJSON = new.participantsJSON
        existing.documentsJSON = new.documentsJSON
    }
}

// MARK: - Publish helpers

extension SyncEngine {

    /// Publishes a task event to all connected relays.
    public func publishTask(
        _ task: TaskifyTask,
        status: String,
        privateKeyBytes: Data,
        pubkeyHex: String
    ) async throws {
        let payload: [String: Any] = buildTaskPayload(task)
        let plaintext = try JSONSerialization.data(withJSONObject: payload)
        let plaintextStr = String(data: plaintext, encoding: .utf8)!
        let encrypted = try encryptTaskPayload(plaintextStr, boardId: task.boardId)

        let bTag = boardTagHash(task.boardId)
        let unsigned = UnsignedNostrEvent(
            pubkey: pubkeyHex,
            kind: TaskifyEventKind.task.rawValue,
            tags: [
                ["d", task.id],
                ["b", bTag],
                ["col", task.column ?? ""],
                ["status", status],
            ],
            content: encrypted
        )
        let event = try unsigned.sign(privateKeyBytes: privateKeyBytes)
        await relayPool.publish(event: event)
    }

    private func buildTaskPayload(_ task: TaskifyTask) -> [String: Any] {
        var d: [String: Any] = [
            "title": task.title,
            "note": task.note ?? "",
            "dueISO": task.dueISO ?? "",
            "completedAt": task.completedAt as Any,
            "completedBy": task.completedBy as Any,
            "priority": task.priority as Any,
            "dueDateEnabled": task.dueDateEnabled as Any,
            "dueTimeEnabled": task.dueTimeEnabled as Any,
            "dueTimeZone": task.dueTimeZone as Any,
            "hiddenUntilISO": task.hiddenUntilISO as Any,
            "streak": task.streak as Any,
            "longestStreak": task.longestStreak as Any,
            "seriesId": task.seriesId as Any,
            "inboxItem": task.inboxItem as Any,
            "recurrence": jsonField(task.recurrenceJSON),
            "subtasks": jsonField(task.subtasksJSON),
            "assignees": jsonField(task.assigneesJSON),
            "documents": jsonField(task.documentsJSON),
            "images": jsonField(task.imagesJSON),
        ]
        return d
    }

    private func jsonField(_ jsonStr: String?) -> Any {
        guard let s = jsonStr, let data = s.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) else { return NSNull() }
        return obj
    }
}

// MARK: - SyncState

public enum SyncState: Equatable {
    case idle
    case syncing(boardId: String)
    case error(String)
}
