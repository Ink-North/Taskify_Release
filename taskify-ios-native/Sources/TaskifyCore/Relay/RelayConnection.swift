/// RelayConnection.swift
/// Single Nostr relay WebSocket connection with automatic reconnection and keepalive pings.
///
/// Improvements over initial version (Primal-informed patterns, no GPL code):
/// - Ping/keepalive every 10s — mirrors Primal's `socket?.ping(interval: 10.0)`.
///   Detects silent dead connections that URLSessionWebSocketTask doesn't surface.
/// - `pingIntervalSeconds` / `maxReconnectDelaySecs` exposed as constants for tests.
/// - `hasPendingMessages()` exposed for test observability.
/// - Ping failure triggers reconnect (same path as receive error).

import Foundation

// MARK: - RelayPoolProtocol

/// Protocol for RelayPool so RelayConnection can be tested with a mock pool.
public protocol RelayPoolProtocol: AnyObject {
    nonisolated func dispatch(message: RelayMessage, from relayUrl: String)
    func relayDidConnect(url: String) async
}

// MARK: - RelayConnection

public actor RelayConnection {

    // MARK: Constants (exposed for tests)

    /// Ping interval in seconds — matches Primal's 10s keepalive.
    public static let pingIntervalSeconds: TimeInterval = 10.0
    /// Maximum reconnect backoff — caps exponential growth.
    public static let maxReconnectDelaySecs: TimeInterval = 30.0

    public let url: String
    private weak var pool: (any RelayPoolProtocol)?
    private var webSocketTask: URLSessionWebSocketTask?
    private var reconnectDelay: TimeInterval = 1.0
    private var shouldReconnect = true
    private var isConnected = false
    private var pendingMessages: [String] = []
    private var pingTask: Task<Void, Never>? = nil

    public init(url: String, pool: any RelayPoolProtocol) {
        self.url = url
        self.pool = pool
    }

    // MARK: Connect / disconnect

    public func connect() async {
        shouldReconnect = true
        await openWebSocket()
    }

    public func disconnect() async {
        shouldReconnect = false
        pingTask?.cancel()
        pingTask = nil
        webSocketTask?.cancel(with: .normalClosure, reason: nil)
        webSocketTask = nil
        isConnected = false
    }

    // MARK: Send

    public func send(_ text: String) async {
        guard let task = webSocketTask, isConnected else {
            pendingMessages.append(text)
            return
        }

        do {
            try await task.send(.string(text))
        } catch {
            pendingMessages.append(text)
            await handleDisconnect()
        }
    }

    // MARK: State queries

    public func connected() -> Bool { isConnected }

    /// Exposed for test observability.
    public func hasPendingMessages() -> Bool { !pendingMessages.isEmpty }

    // MARK: Internal — WebSocket lifecycle

    private func openWebSocket() async {
        guard let wsURL = URL(string: url) else { return }
        let session = URLSession(configuration: .default)
        let task = session.webSocketTask(with: wsURL)
        webSocketTask = task
        task.resume()
        isConnected = true
        reconnectDelay = 1.0
        startReceiving(task: task)
        startPingLoop(task: task)
        Task { [weak self] in
            guard let self else { return }
            await self.finishOpenWebSocket()
        }
    }

    private func startReceiving(task: URLSessionWebSocketTask) {
        Task {
            while true {
                do {
                    let message = try await task.receive()
                    switch message {
                    case .string(let text):
                        if let parsed = RelayMessage.parse(text) {
                            pool?.dispatch(message: parsed, from: url)
                        }
                    case .data(let data):
                        if let text = String(data: data, encoding: .utf8),
                           let parsed = RelayMessage.parse(text) {
                            pool?.dispatch(message: parsed, from: url)
                        }
                    @unknown default:
                        break
                    }
                } catch {
                    await handleDisconnect()
                    return
                }
            }
        }
    }

    /// Sends a WebSocket ping every `pingIntervalSeconds`.
    /// If the ping fails, it means the connection is silently dead — trigger reconnect.
    /// Mirrors Primal's `socket?.ping(interval: 10.0)` behaviour.
    ///
    /// Uses the callback-based `sendPing(pongReceiveHandler:)` API wrapped in a continuation
    /// because `URLSessionWebSocketTask` does not have an async `sendPing()` overload.
    private func startPingLoop(task: URLSessionWebSocketTask) {
        pingTask?.cancel()
        pingTask = Task { [weak self] in
            while true {
                try? await Task.sleep(nanoseconds: UInt64(Self.pingIntervalSeconds * 1_000_000_000))
                guard let self, !Task.isCancelled else { return }
                let stillConnected = await self.connected()
                guard stillConnected else { return }
                let pingError = await withCheckedContinuation { (continuation: CheckedContinuation<(any Error)?, Never>) in
                    task.sendPing { error in
                        continuation.resume(returning: error)
                    }
                }
                if pingError != nil {
                    // Ping failed — connection is silently dead
                    await self.handleDisconnect()
                    return
                }
            }
        }
    }

    private func flushPendingMessages() async {
        guard let task = webSocketTask, isConnected, !pendingMessages.isEmpty else { return }
        let queued = pendingMessages
        pendingMessages.removeAll()

        for message in queued {
            do {
                try await task.send(.string(message))
            } catch {
                pendingMessages.insert(message, at: 0)
                await handleDisconnect()
                return
            }
        }
    }

    private func finishOpenWebSocket() async {
        try? await Task.sleep(nanoseconds: 150_000_000)
        await flushPendingMessages()
        if let pool {
            await pool.relayDidConnect(url: url)
        }
    }

    private func handleDisconnect() async {
        pingTask?.cancel()
        pingTask = nil
        isConnected = false
        webSocketTask = nil
        guard shouldReconnect else { return }
        try? await Task.sleep(nanoseconds: UInt64(reconnectDelay * 1_000_000_000))
        reconnectDelay = min(reconnectDelay * 2, Self.maxReconnectDelaySecs)
        await openWebSocket()
    }
}
