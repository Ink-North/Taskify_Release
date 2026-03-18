/// RelayConnection.swift
/// Single Nostr relay WebSocket connection with automatic reconnection.

import Foundation

public actor RelayConnection {

    public let url: String
    private weak var pool: RelayPool?
    private var webSocketTask: URLSessionWebSocketTask?
    private var reconnectDelay: TimeInterval = 1.0
    private var shouldReconnect = true
    public private(set) var isConnected = false

    public init(url: String, pool: RelayPool) {
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
        webSocketTask?.cancel(with: .normalClosure, reason: nil)
        webSocketTask = nil
        isConnected = false
    }

    // MARK: Send

    public func send(_ text: String) async {
        guard let task = webSocketTask, isConnected else { return }
        try? await task.send(.string(text))
    }

    // MARK: Internal

    private func openWebSocket() async {
        guard let wsURL = URL(string: url) else { return }
        let session = URLSession(configuration: .default)
        let task = session.webSocketTask(with: wsURL)
        webSocketTask = task
        task.resume()
        isConnected = true
        reconnectDelay = 1.0
        startReceiving(task: task)
    }

    private func startReceiving(task: URLSessionWebSocketTask) {
        Task {
            while true {
                do {
                    let message = try await task.receive()
                    switch message {
                    case .string(let text):
                        if let parsed = RelayMessage.parse(text) {
                            pool?.receive(message: parsed, from: url)
                        }
                    case .data(let data):
                        if let text = String(data: data, encoding: .utf8),
                           let parsed = RelayMessage.parse(text) {
                            pool?.receive(message: parsed, from: url)
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

    private func handleDisconnect() async {
        isConnected = false
        guard shouldReconnect else { return }
        try? await Task.sleep(nanoseconds: UInt64(reconnectDelay * 1_000_000_000))
        reconnectDelay = min(reconnectDelay * 2, 30.0) // exponential backoff, max 30s
        await openWebSocket()
    }
}
