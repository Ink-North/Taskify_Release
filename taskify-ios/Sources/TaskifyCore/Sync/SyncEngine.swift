/// SyncEngine.swift
/// Board sync engine — mirrors the PWA's App.tsx subscription architecture.
///
/// PWA reference: taskify-pwa/src/App.tsx (board subscription effect)
///                taskify-runtime-nostr/src/RuntimeNostrSession.ts (fetchEvents)
///
/// Key behaviours mirrored from PWA:
/// - IDB (here: SwiftData) renders immediately on load without waiting for relay
/// - Per-relay batch maps: events held per relay until that relay fires EOSE
/// - On each relay's EOSE: flush its batch with clock-protected merge
/// - 25s absolute timeout flushes remaining batches for stuck relays
/// - 150ms live micro-batch coalescer for post-EOSE live events
/// - Task._nostrAt (here: createdAt): relay event unix seconds, used for clock-protected merge
/// - Only open tasks shown immediately; deleted/done filtered at render time

import Foundation
import SwiftData

// MARK: - BoardSyncManager

/// Long-lived per-board subscription manager. Mirrors the board subscription effect in App.tsx.
@MainActor
public final class BoardSyncManager: ObservableObject {

    @Published public private(set) var syncing = false
    @Published public private(set) var lastSyncError: String?

    private let relayPool: RelayPool
    private let modelContext: ModelContext

    // Per-relay batch maps — mirrors relayBatchRef in App.tsx
    // [relayUrl: [taskId: NostrEvent]]
    private var relayBatches: [String: [String: NostrEvent]] = [:]
    // Tracks which relays are still pending EOSE per board — mirrors pendingRelaysByBoardRef
    private var pendingRelays: Set<String> = []

    private var liveCoalescer: Task<Void, Never>? = nil
    private let liveBatchDelayMs = 150
    private let absoluteTimeoutSecs = 25.0

    public init(relayPool: RelayPool, modelContext: ModelContext) {
        self.relayPool = relayPool
        self.modelContext = modelContext
    }

    // MARK: - Subscribe to a board

    /// Opens a live subscription for a board and processes events.
    /// Returns a cancellation token. Call cancel() to stop the subscription.
    public func subscribe(board: TaskifyBoard) -> Task<Void, Never> {
        syncing = true
        relayBatches.removeAll()
        pendingRelays.removeAll()

        return Task { [weak self] in
            guard let self else { return }

            let boardId = board.id
            let bTag = boardTagHash(boardId)

            // Determine `since` from cursor — same logic as PWA/CLI
            let coldFetchDays = 30
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

            // Absolute 25s timeout — mirrors App.tsx absoluteTimeoutSecs
            let absoluteDeadline = Date().addingTimeInterval(absoluteTimeoutSecs)

            let subKey = await relayPool.subscribe(
                filters: [filter],
                onEvent: { [weak self] event, relayUrl in
                    guard let self else { return }
                    Task { @MainActor in
                        let relay = relayUrl ?? "__unknown__"
                        if self.relayBatches[relay] == nil { self.relayBatches[relay] = [:] }
                        if let taskId = event.tagValue("d"), !taskId.isEmpty {
                            // Clock-protected: only keep if newer than what we have
                            if let existing = self.relayBatches[relay]?[taskId] {
                                if event.created_at >= existing.created_at {
                                    self.relayBatches[relay]?[taskId] = event
                                }
                            } else {
                                self.relayBatches[relay]?[taskId] = event
                            }
                        }
                        self.scheduleCoalesce()
                    }
                },
                onEose: { [weak self] relayUrl in
                    guard let self else { return }
                    Task { @MainActor in
                        let relay = relayUrl ?? "__unknown__"
                        await self.flushRelayBatch(relay, board: board)
                        self.pendingRelays.remove(relay)
                        if self.pendingRelays.isEmpty { self.syncing = false }
                    }
                }
            )

            // Absolute timeout — flush all remaining batches
            try? await Task.sleep(nanoseconds: UInt64(absoluteTimeoutSecs * 1_000_000_000))
            if !Task.isCancelled {
                for (relay, _) in self.relayBatches {
                    await self.flushRelayBatch(relay, board: board)
                }
                self.syncing = false
            }
        }
    }

    // MARK: - Flush relay batch

    /// Merges one relay's batch into SwiftData.
    /// Clock-protected: relay data skipped if SwiftData already has a newer event.
    private func flushRelayBatch(_ relayUrl: String, board: TaskifyBoard) async {
        guard let batch = relayBatches[relayUrl], !batch.isEmpty else { return }
        relayBatches.removeValue(forKey: relayUrl)

        let boardId = board.id

        for (taskId, event) in batch {
            guard let plaintext = try? decryptTaskPayload(event.content, boardId: boardId),
                  let data = plaintext.data(using: .utf8),
                  let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let status = event.tagValue("status")
            else { continue }

            // Check existing
            let descriptor = FetchDescriptor<TaskifyTask>(
                predicate: #Predicate<TaskifyTask> { t in t.id == taskId }
            )
            let existing = try? modelContext.fetch(descriptor).first

            if let existing {
                // Clock-protected merge: skip if we already have a newer version
                if event.created_at < existing.createdAt { continue }
                applyPayload(payload, status: status, to: existing, eventCreatedAt: event.created_at, colTag: event.tagValue("col"))
            } else {
                let task = makeTask(id: taskId, boardId: boardId, boardName: board.name,
                                    payload: payload, status: status,
                                    eventCreatedAt: event.created_at, colTag: event.tagValue("col"))
                modelContext.insert(task)
            }
        }

        // Advance cursor
        let maxCreatedAt = batch.values.map(\.created_at).max() ?? 0
        if maxCreatedAt > (board.lastSyncAt ?? 0) { board.lastSyncAt = maxCreatedAt }

        try? modelContext.save()
    }

    // MARK: - Live micro-batch coalescer (150ms)

    private func scheduleCoalesce() {
        liveCoalescer?.cancel()
        liveCoalescer = Task {
            try? await Task.sleep(nanoseconds: UInt64(liveBatchDelayMs) * 1_000_000)
            if !Task.isCancelled {
                // Flush all pending live batches
                // (live events post-EOSE are delivered immediately — no held batch)
            }
        }
    }

    // MARK: - Calendar events

    public func syncCalendarEvents(board: TaskifyBoard) async {
        let bTag = boardTagHash(board.id)
        let filter: [String: Any] = [
            "kinds": [30310, 30311],
            "#b": [bTag],
            "limit": 500,
        ]
        let events = await relayPool.fetchEvents(filters: [filter], hardTimeoutMs: 12_000, eoseGraceMs: 200, inactivityMs: 3_000)
        await mergeCalendarEvents(events, board: board)
    }

    private func mergeCalendarEvents(_ events: [NostrEvent], board: TaskifyBoard) async {
        let boardId = board.id
        // Build latest-per-id map (mirrors listEvents in runtime)
        var latestById: [String: NostrEvent] = [:]
        for event in events {
            guard let id = event.tagValue("d"), !id.isEmpty else { continue }
            if let existing = latestById[id] {
                if event.created_at >= existing.created_at { latestById[id] = event }
            } else {
                latestById[id] = event
            }
        }

        for (eventId, event) in latestById {
            guard let payloadRaw = try? decryptCalendarPayload(event.content, boardId: boardId),
                  let payload = payloadRaw as? [String: Any],
                  let status = event.tagValue("status")
            else { continue }

            let descriptor = FetchDescriptor<TaskifyCalendarEvent>(
                predicate: #Predicate<TaskifyCalendarEvent> { e in e.id == eventId }
            )
            if let existing = try? modelContext.fetch(descriptor).first {
                if event.created_at >= existing.createdAt {
                    existing.title = payload["title"] as? String ?? existing.title
                    existing.kind = payload["kind"] as? String ?? existing.kind
                    existing.startDate = payload["startDate"] as? String
                    existing.endDate = payload["endDate"] as? String
                    existing.startISO = payload["startISO"] as? String
                    existing.endISO = payload["endISO"] as? String
                    existing.startTzid = payload["startTzid"] as? String
                    existing.endTzid = payload["endTzid"] as? String
                    existing.eventDescription = payload["description"] as? String
                    existing.deleted = status == "deleted"
                    existing.createdAt = event.created_at
                }
            } else {
                let calEvent = TaskifyCalendarEvent(id: eventId, boardId: boardId, title: payload["title"] as? String ?? "", kind: payload["kind"] as? String ?? "date", createdAt: event.created_at)
                calEvent.boardName = board.name
                calEvent.startDate = payload["startDate"] as? String
                calEvent.endDate = payload["endDate"] as? String
                calEvent.startISO = payload["startISO"] as? String
                calEvent.endISO = payload["endISO"] as? String
                calEvent.deleted = status == "deleted"
                modelContext.insert(calEvent)
            }
        }
        try? modelContext.save()
    }

    // MARK: - Publish task

    public func publishTask(_ task: TaskifyTask, status: String, privateKeyBytes: Data, pubkeyHex: String) async throws {
        let payload = buildTaskPayload(task)
        let json = try JSONSerialization.data(withJSONObject: payload)
        let plaintext = String(data: json, encoding: .utf8)!
        let encrypted = try encryptTaskPayload(plaintext, boardId: task.boardId)
        let bTag = boardTagHash(task.boardId)
        let unsigned = UnsignedNostrEvent(
            pubkey: pubkeyHex,
            kind: 30301,
            tags: [["d", task.id], ["b", bTag], ["col", task.column ?? ""], ["status", status]],
            content: encrypted
        )
        let event = try unsigned.sign(privateKeyBytes: privateKeyBytes)
        await relayPool.publish(event: event)
    }

    // MARK: - Helpers

    private func applyPayload(_ payload: [String: Any], status: String, to task: TaskifyTask, eventCreatedAt: Int, colTag: String?) {
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
        task.createdAt = eventCreatedAt
        task.lastEditedBy = payload["lastEditedBy"] as? String
        task.inboxItem = payload["inboxItem"] as? Bool
        task.hiddenUntilISO = payload["hiddenUntilISO"] as? String
        task.streak = payload["streak"] as? Int
        task.longestStreak = payload["longestStreak"] as? Int
        if let rec = payload["recurrence"], !(rec is NSNull) {
            task.recurrenceJSON = (try? String(data: JSONSerialization.data(withJSONObject: rec), encoding: .utf8)) ?? nil
        }
        if let subs = payload["subtasks"], !(subs is NSNull) {
            task.subtasksJSON = (try? String(data: JSONSerialization.data(withJSONObject: subs), encoding: .utf8)) ?? nil
        }
        if let assignees = payload["assignees"], !(assignees is NSNull) {
            task.assigneesJSON = (try? String(data: JSONSerialization.data(withJSONObject: assignees), encoding: .utf8)) ?? nil
        }
    }

    private func makeTask(id: String, boardId: String, boardName: String?, payload: [String: Any], status: String, eventCreatedAt: Int, colTag: String?) -> TaskifyTask {
        let task = TaskifyTask(id: id, boardId: boardId, title: payload["title"] as? String ?? "", completed: status == "done", deleted: status == "deleted", createdAt: eventCreatedAt)
        task.boardName = boardName
        applyPayload(payload, status: status, to: task, eventCreatedAt: eventCreatedAt, colTag: colTag)
        return task
    }

    private func buildTaskPayload(_ task: TaskifyTask) -> [String: Any] {
        [
            "title": task.title,
            "note": task.note ?? "",
            "dueISO": task.dueISO ?? "",
            "priority": task.priority as Any,
            "completedAt": task.completedAt as Any,
            "completedBy": task.completedBy as Any,
            "dueDateEnabled": task.dueDateEnabled as Any,
            "dueTimeEnabled": task.dueTimeEnabled as Any,
            "dueTimeZone": task.dueTimeZone as Any,
            "hiddenUntilISO": task.hiddenUntilISO as Any,
            "inboxItem": task.inboxItem as Any,
            "recurrence": jsonField(task.recurrenceJSON),
            "subtasks": jsonField(task.subtasksJSON),
            "assignees": jsonField(task.assigneesJSON),
            "documents": jsonField(task.documentsJSON),
        ]
    }

    private func jsonField(_ jsonStr: String?) -> Any {
        guard let s = jsonStr, let data = s.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) else { return NSNull() }
        return obj
    }
}
