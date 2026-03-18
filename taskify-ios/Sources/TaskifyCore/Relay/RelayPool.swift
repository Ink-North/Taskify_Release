/// RelayPool.swift
/// WebSocket connection pool for Nostr relays.
/// Manages multiple relay connections, reconnection backoff, and message dispatch.

import Foundation

// MARK: - RelayPool

/// Manages a set of Nostr relay connections.
/// Thread-safe via Swift actors.
public actor RelayPool {

    // MARK: State

    private var relays: [String: RelayConnection] = [:]
    private var messageHandlers: [String: AsyncStream<RelayMessage>.Continuation] = [:]

    // MARK: Init

    public init() {}

    // MARK: Connect / disconnect

    /// Connects to all configured relay URLs.
    public func connect(urls: [String]) async {
        for url in urls {
            guard relays[url] == nil else { continue }
            let conn = RelayConnection(url: url, pool: self)
            relays[url] = conn
            await conn.connect()
        }
    }

    public func disconnect() async {
        for (_, conn) in relays { await conn.disconnect() }
        relays.removeAll()
    }

    // MARK: Subscribe

    /// Sends a REQ to all connected relays.
    public func subscribe(id: String, filters: [[String: Any]]) async {
        let req = buildReq(id: id, filters: filters)
        for (_, conn) in relays { await conn.send(req) }
    }

    /// Closes a subscription on all relays.
    public func unsubscribe(id: String) async {
        let close = buildClose(id: id)
        for (_, conn) in relays { await conn.send(close) }
    }

    /// Publishes an event to all connected relays.
    public func publish(event: NostrEvent) async {
        let json = buildEvent(event: event)
        for (_, conn) in relays { await conn.send(json) }
    }

    // MARK: Internal message dispatch

    nonisolated func receive(message: RelayMessage, from url: String) {
        Task {
            await self._dispatch(message: message, from: url)
        }
    }

    private var subscriptionStreams: [String: [AsyncStream<RelayMessage>.Continuation]] = [:]

    private func _dispatch(message: RelayMessage, from url: String) {
        switch message {
        case .event(let subId, _), .eose(let subId), .closed(let subId, _):
            subscriptionStreams[subId]?.forEach { $0.yield(message) }
        default:
            break
        }
    }

    /// Returns an AsyncStream for the given subscription id.
    public func stream(for subscriptionId: String) -> AsyncStream<RelayMessage> {
        AsyncStream { continuation in
            if subscriptionStreams[subscriptionId] == nil {
                subscriptionStreams[subscriptionId] = []
            }
            subscriptionStreams[subscriptionId]?.append(continuation)
            continuation.onTermination = { [weak self] _ in
                Task { await self?.removeStream(subscriptionId: subscriptionId, continuation: continuation) }
            }
        }
    }

    private func removeStream(subscriptionId: String, continuation: AsyncStream<RelayMessage>.Continuation) {
        subscriptionStreams[subscriptionId]?.removeAll(where: { _ in true }) // simplified
    }

    // MARK: EOSE tracking

    public func waitForEOSE(
        subscriptionId: String,
        relayCount: Int,
        inactivityMs: Int = 3000,
        hardTimeoutMs: Int = 12000
    ) async -> AsyncStream<RelayMessage> {
        AsyncStream { continuation in
            Task {
                var eoseCount = 0
                let deadline = Date().addingTimeInterval(Double(hardTimeoutMs) / 1000)
                var inactivityTask: Task<Void, Never>? = nil

                func resetInactivity() {
                    inactivityTask?.cancel()
                    inactivityTask = Task {
                        try? await Task.sleep(nanoseconds: UInt64(inactivityMs) * 1_000_000)
                        if !Task.isCancelled { continuation.finish() }
                    }
                }

                for await msg in await self.stream(for: subscriptionId) {
                    if Date() > deadline { continuation.finish(); break }
                    continuation.yield(msg)
                    switch msg {
                    case .event: resetInactivity()
                    case .eose:
                        eoseCount += 1
                        if eoseCount >= relayCount { continuation.finish(); return }
                        resetInactivity()
                    default: break
                    }
                }
            }
        }
    }

    // MARK: Connection status

    public func connectedRelayCount() -> Int {
        relays.values.filter { $0.isConnected }.count
    }

    public func relayStatuses() -> [(url: String, connected: Bool)] {
        relays.map { (url: $0.key, connected: $0.value.isConnected) }
    }

    // MARK: Message builders

    private func buildReq(_ id: String, filters: [[String: Any]]) -> String {
        var arr: [Any] = ["REQ", id]
        arr.append(contentsOf: filters)
        let data = try! JSONSerialization.data(withJSONObject: arr)
        return String(data: data, encoding: .utf8)!
    }

    private func buildReq(id: String, filters: [[String: Any]]) -> String {
        buildReq(id, filters: filters)
    }

    private func buildClose(id: String) -> String {
        let arr: [Any] = ["CLOSE", id]
        let data = try! JSONSerialization.data(withJSONObject: arr)
        return String(data: data, encoding: .utf8)!
    }

    private func buildEvent(event: NostrEvent) -> String {
        guard let data = try? JSONEncoder().encode(event),
              let dict = try? JSONSerialization.jsonObject(with: data) else { return "" }
        let arr: [Any] = ["EVENT", dict]
        let msg = try! JSONSerialization.data(withJSONObject: arr)
        return String(data: msg, encoding: .utf8)!
    }
}
