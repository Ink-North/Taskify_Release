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
        case .signedIn(let profile):
            NativeAppShellView(profile: profile)
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

private struct NativeAppShellView: View {
    @StateObject private var shellVM: AppShellViewModel

    init(profile: TaskifyProfile) {
        _shellVM = StateObject(wrappedValue: AppShellViewModel(profile: profile))
    }

    var body: some View {
        TabView(selection: Binding(
            get: { shellVM.selectedTab },
            set: { shellVM.select(tab: $0) }
        )) {
            BoardsShellScreen(shellVM: shellVM)
                .tabItem { Label("Boards", systemImage: "square.grid.2x2") }
                .tag(AppShellViewModel.Tab.boards)

            HomeShellScreen(profileName: shellVM.profile.name)
                .tabItem { Label("Home", systemImage: "house") }
                .tag(AppShellViewModel.Tab.home)
        }
    }
}

private struct BoardsShellScreen: View {
    @ObservedObject var shellVM: AppShellViewModel
    @StateObject private var boardListVM = BoardListViewModel()

    var body: some View {
        NavigationStack {
            Group {
                switch boardListVM.state {
                case .loading:
                    ProgressView("Loading boards…")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                case .empty:
                    VStack(spacing: 12) {
                        Image(systemName: "tray")
                            .font(.title2)
                            .foregroundStyle(.secondary)
                        Text(shellVM.boardsEmptyMessage)
                            .font(.subheadline)
                            .multilineTextAlignment(.center)
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .padding(24)
                case .error(let message):
                    VStack(spacing: 12) {
                        Image(systemName: "exclamationmark.triangle")
                            .font(.title2)
                            .foregroundStyle(.orange)
                        Text(message)
                            .font(.subheadline)
                            .multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .padding(24)
                case .ready:
                    List(boardListVM.visibleBoards, id: \.id) { board in
                        Button {
                            boardListVM.selectBoard(id: board.id)
                        } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(board.name).font(.headline)
                                    Text(board.id).font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                                if boardListVM.selectedBoardId == board.id {
                                    Image(systemName: "checkmark.circle.fill")
                                        .foregroundStyle(.blue)
                                }
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .navigationTitle("Boards")
            .onAppear {
                boardListVM.setBoards(shellVM.profile.boards)
            }
        }
    }
}

private struct HomeShellScreen: View {
    let profileName: String

    var body: some View {
        NavigationStack {
            VStack(spacing: 8) {
                Text("Welcome, \(profileName)")
                    .font(.title3.bold())
                Text("Native home scaffold — parity slices in progress.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding(24)
            .navigationTitle("Home")
        }
    }
}

private struct SignInView: View {
    @EnvironmentObject private var authVM: AppAuthViewModel
    let errorMessage: String?

    var body: some View {
        let signInVM = authVM.signInViewModel
        VStack(spacing: 16) {
            Text("Taskify")
                .font(.largeTitle.bold())
            Text("Sign in with nsec or 64-hex private key")
                .font(.subheadline)
                .foregroundStyle(.secondary)

            TextField("Profile name", text: Binding(
                get: { signInVM.profileName },
                set: { signInVM.profileName = $0 }
            ))
            .textFieldStyle(.roundedBorder)

            TextField("nsec1... or 64-hex", text: Binding(
                get: { signInVM.secretKeyInput },
                set: { signInVM.secretKeyInput = $0 }
            ))
            .textFieldStyle(.roundedBorder)

            if let msg = signInVM.errorMessage, !msg.isEmpty {
                Text(msg)
                    .font(.footnote)
                    .foregroundStyle(.red)
            }

            Button("Sign In") {
                _ = signInVM.submit()
            }
            .buttonStyle(.borderedProminent)
            .disabled(!signInVM.canSubmit)
        }
        .onAppear { signInVM.applyExternalError(errorMessage) }
        .onChange(of: errorMessage) { _, newValue in signInVM.applyExternalError(newValue) }
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

    lazy var signInViewModel: SignInViewModel = {
        SignInViewModel { [weak self] secretKeyInput, profileName in
            guard let self else { return .error("Unable to sign in. Please check your private key.") }
            self.manager.signIn(secretKeyInput: secretKeyInput, profileName: profileName, relays: AuthSessionManager.defaultRelayPreset)
            self.state = self.manager.state
            return self.manager.state
        }
    }()

    func bootstrap() async {
        manager.bootstrap()
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
