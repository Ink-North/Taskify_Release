import SwiftUI
import WebKit
import TaskifyCore
#if os(iOS)
import AppIntents
#endif

@main
struct TaskifyApp: App {
    @State private var currentURL = URL(string: "https://taskify.solife.me")!
    #if os(iOS)
    @State private var pendingVoicePayload: VoiceCaptureIntentPayload?
    @Environment(\.scenePhase) private var scenePhase
    #endif

    var body: some Scene {
        WindowGroup {
            contentView
                .ignoresSafeArea()
                .task {
                    #if os(iOS)
                    TaskifyShortcutsProvider.updateAppShortcutParameters()
                    applyPendingVoiceIntentIfNeeded()
                    #endif
                }
                #if os(iOS)
                .onChange(of: scenePhase) { _, newPhase in
                    guard newPhase == .active else { return }
                    applyPendingVoiceIntentIfNeeded()
                }
                #endif
        }
    }

    @ViewBuilder
    private var contentView: some View {
        #if os(iOS)
        TaskifyWebWrapperView(
            url: currentURL,
            pendingVoicePayload: pendingVoicePayload,
            onPendingVoicePayloadConsumed: { pendingVoicePayload = nil }
        )
        #else
        TaskifyWebWrapperView(url: currentURL)
        #endif
    }

    #if os(iOS)
    private func applyPendingVoiceIntentIfNeeded() {
        guard let pending = VoiceCaptureIntentStore.consumePending() else { return }
        pendingVoicePayload = pending
    }
    #endif
}

#if os(iOS)
struct TaskifyWebWrapperView: UIViewRepresentable {
    let url: URL
    let pendingVoicePayload: VoiceCaptureIntentPayload?
    let onPendingVoicePayloadConsumed: () -> Void

    func makeUIView(context: Context) -> WKWebView {
        makeWebView(context: context)
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        updateWebView(webView, context: context)
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(onPendingVoicePayloadConsumed: onPendingVoicePayloadConsumed)
    }
}
#elseif os(macOS)
import AppKit

struct TaskifyWebWrapperView: NSViewRepresentable {
    let url: URL

    func makeNSView(context: Context) -> WKWebView {
        makeWebView(context: context)
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        updateWebView(webView)
    }

    func makeCoordinator() -> Coordinator { Coordinator() }
}
#endif

extension TaskifyWebWrapperView {
    fileprivate func makeWebView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        #if os(iOS)
        config.allowsInlineMediaPlayback = true
        config.userContentController.add(context.coordinator, name: "taskifyIOS")
        #endif

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true

        #if os(iOS)
        webView.isOpaque = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        #endif

        webView.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalAndRemoteCacheData))
        return webView
    }

    #if os(iOS)
    fileprivate func updateWebView(_ webView: WKWebView, context: Context) {
        if webView.url?.absoluteString != url.absoluteString {
            webView.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalAndRemoteCacheData))
        }
        if let pendingVoicePayload {
            context.coordinator.queueVoicePayload(pendingVoicePayload, on: webView)
        }
    }
    #else
    fileprivate func updateWebView(_ webView: WKWebView) {
        guard webView.url?.absoluteString != url.absoluteString else { return }
        webView.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalAndRemoteCacheData))
    }
    #endif

    final class Coordinator: NSObject, WKNavigationDelegate {
        #if os(iOS)
        private let onPendingVoicePayloadConsumed: () -> Void
        private var queuedVoicePayload: VoiceCaptureIntentPayload?
        private var isWebBridgeReady = false

        init(onPendingVoicePayloadConsumed: @escaping () -> Void) {
            self.onPendingVoicePayloadConsumed = onPendingVoicePayloadConsumed
            super.init()
        }

        func queueVoicePayload(_ payload: VoiceCaptureIntentPayload, on webView: WKWebView) {
            queuedVoicePayload = payload
            dispatchVoicePayloadIfPossible(on: webView)
        }

        private func dispatchVoicePayloadIfPossible(on webView: WKWebView) {
            guard isWebBridgeReady else { return }
            guard let payload = queuedVoicePayload else { return }
            guard let data = try? JSONEncoder().encode(payload), let json = String(data: data, encoding: .utf8) else { return }

            let script = """
            (function() {
              const detail = \(json);
              window.dispatchEvent(new CustomEvent('taskify-ios-voice-add', { detail }));
            })();
            """

            webView.evaluateJavaScript(script) { _, error in
                guard error == nil else { return }
                self.queuedVoicePayload = nil
                self.onPendingVoicePayloadConsumed()
            }
        }
        #else
        override init() {
            super.init()
        }
        #endif

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            decisionHandler(.allow)
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            #if os(iOS)
            isWebBridgeReady = false
            #endif
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            #if os(iOS)
            dispatchVoicePayloadIfPossible(on: webView)
            #endif
        }

        #if os(iOS)
        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == "taskifyIOS" else { return }
            guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
            if type == "ready" {
                isWebBridgeReady = true
                if let webView = message.webView {
                    dispatchVoicePayloadIfPossible(on: webView)
                }
            }
        }
        #endif

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            showError(in: webView, error: error)
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            showError(in: webView, error: error)
        }

        private func showError(in webView: WKWebView, error: Error) {
            let message = (error as NSError).localizedDescription
            let html = """
            <html><head><meta name='viewport' content='width=device-width,initial-scale=1'/></head>
            <body style='font-family:-apple-system;padding:24px;background:#0b1424;color:#fff;'>
              <h2 style='margin:0 0 12px 0;'>Unable to load Taskify</h2>
              <p style='opacity:.85;line-height:1.4;'>The configured web URL could not be reached.</p>
              <p style='opacity:.7;line-height:1.4;word-break:break-word;'><strong>Error:</strong> \(message)</p>
              <p style='opacity:.7;line-height:1.4;'>If this persists, update the wrapped URL in <code>TaskifyApp.swift</code> to your deployed PWA domain.</p>
            </body></html>
            """
            webView.loadHTMLString(html, baseURL: nil)
        }
    }
}

#if os(iOS)
extension TaskifyWebWrapperView.Coordinator: WKScriptMessageHandler {}

struct AddTaskIntent: AppIntent {
    static var title: LocalizedStringResource = "Add Task"
    static var description = IntentDescription("Create a new task in Taskify using voice.")
    static var openAppWhenRun: Bool = true

    @Parameter(title: "Task")
    var titleText: String

    @Parameter(title: "Due Date")
    var dueDate: Date?

    func perform() async throws -> some IntentResult {
        let trimmedTitle = titleText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedTitle.isEmpty else {
            throw NSError(domain: "Taskify", code: 2, userInfo: [NSLocalizedDescriptionKey: "Task title cannot be empty"])
        }

        VoiceCaptureIntentStore.savePending(
            VoiceCaptureIntentPayload(
                title: trimmedTitle,
                dueDate: dueDate,
                boardName: nil
            )
        )

        return .result()
    }
}

struct TaskifyShortcutsProvider: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: AddTaskIntent(),
            phrases: [
                "Add task in \(.applicationName)",
                "Add a task in \(.applicationName)",
                "Create task in \(.applicationName)",
                "Create a task in \(.applicationName)"
            ],
            shortTitle: "Add Task",
            systemImageName: "plus.circle"
        )
    }
}
#endif
