import SwiftUI
import WebKit
import TaskifyCore

// MARK: - App

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

private struct RootView: View {
    @EnvironmentObject private var authVM: AppAuthViewModel

    var body: some View {
        switch authVM.state {
        case .signedIn:
            TaskifyWebWrapperView(url: URL(string: "https://taskify.solife.me")!)
                .ignoresSafeArea()
        case .importing:
            ProgressView("Signing in…")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color.black.opacity(0.02))
        case .error(let message):
            SignInView(errorMessage: message)
        case .signedOut:
            SignInView(errorMessage: nil)
        }
    }
}

private struct SignInView: View {
    @EnvironmentObject private var authVM: AppAuthViewModel
    let errorMessage: String?

    @State private var secretKeyInput = ""
    @State private var profileName = ""

    var body: some View {
        VStack(spacing: 16) {
            Text("Taskify")
                .font(.largeTitle.bold())
            Text("Sign in with nsec or 64-hex private key")
                .font(.subheadline)
                .foregroundStyle(.secondary)

            TextField("Profile name", text: $profileName)
                .textFieldStyle(.roundedBorder)
            TextField("nsec1... or 64-hex", text: $secretKeyInput)
                .textFieldStyle(.roundedBorder)

            if let errorMessage, !errorMessage.isEmpty {
                Text(errorMessage)
                    .font(.footnote)
                    .foregroundStyle(.red)
            }

            Button("Sign In") {
                Task { await authVM.signIn(secretKeyInput: secretKeyInput, profileName: profileName) }
            }
            .buttonStyle(.borderedProminent)
        }
        .padding(24)
        .frame(maxWidth: 460)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.black.opacity(0.02))
    }
}

@MainActor
private final class AppAuthViewModel: ObservableObject {
    @Published var state: AuthState = .signedOut

    private let manager = AuthSessionManager(
        loadActiveProfile: { try KeychainStore.loadActiveProfile() },
        saveProfile: { profile in try KeychainStore.saveProfile(profile) },
        importIdentity: { input in try NostrIdentityService.importIdentity(secretKeyInput: input) }
    )

    func bootstrap() async {
        manager.bootstrap()
        state = manager.state
    }

    func signIn(secretKeyInput: String, profileName: String) async {
        manager.signIn(secretKeyInput: secretKeyInput, profileName: profileName, relays: ["wss://relay.damus.io", "wss://relay.snort.social"])
        state = manager.state
    }
}

// MARK: - WebView (iOS)

#if os(iOS)
struct TaskifyWebWrapperView: UIViewRepresentable {
    let url: URL

    func makeUIView(context: Context) -> WKWebView {
        makeWebView(context: context)
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator() }
}

// MARK: - WebView (macOS)

#elseif os(macOS)
import AppKit

struct TaskifyWebWrapperView: NSViewRepresentable {
    let url: URL

    func makeNSView(context: Context) -> WKWebView {
        makeWebView(context: context)
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        guard webView.url?.absoluteString != url.absoluteString else { return }
        webView.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalAndRemoteCacheData))
    }

    func makeCoordinator() -> Coordinator { Coordinator() }
}
#endif

// MARK: - Shared setup

extension TaskifyWebWrapperView {
    fileprivate func makeWebView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        #if os(iOS)
        config.allowsInlineMediaPlayback = true
        #endif

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
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

    // MARK: - Coordinator

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            decisionHandler(.allow)
        }

        @available(iOS 15.0, *)
        func webView(
            _ webView: WKWebView,
            requestMediaCapturePermissionFor origin: WKSecurityOrigin,
            initiatedByFrame frame: WKFrameInfo,
            type: WKMediaCaptureType,
            decisionHandler: @escaping (WKPermissionDecision) -> Void
        ) {
            // For our first-party Taskify web app, grant capture so iOS can present/resolve mic permission.
            // Do not grant for arbitrary origins.
            if origin.host.contains("taskify.solife.me") {
                decisionHandler(.grant)
            } else {
                decisionHandler(.deny)
            }
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            showError(in: webView, error: error)
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            showError(in: webView, error: error)
        }

        private func showError(in webView: WKWebView, error: Error) {
            let e = error as NSError
            guard !(e.domain == NSURLErrorDomain && e.code == NSURLErrorCancelled) else { return }
            webView.loadHTMLString("""
            <html><head><meta name='viewport' content='width=device-width,initial-scale=1'/></head>
            <body style='font-family:-apple-system;padding:24px;background:#0b1424;color:#fff;'>
              <h2 style='margin:0 0 12px 0;'>Unable to load Taskify</h2>
              <p style='opacity:.85;line-height:1.4;'>The configured web URL could not be reached.</p>
              <p style='opacity:.7;line-height:1.4;word-break:break-word;'><strong>Error:</strong> \(e.localizedDescription)</p>
            </body></html>
            """, baseURL: nil)
        }
    }
}
