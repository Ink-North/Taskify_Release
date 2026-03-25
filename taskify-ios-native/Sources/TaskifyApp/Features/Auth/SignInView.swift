import SwiftUI
import Security
import TaskifyCore

private enum OnboardingPage {
    case home
    case signIn
    case create
    case restore
    case notifications
}

struct SignInView: View {
    @EnvironmentObject private var authVM: AppAuthViewModel
    let errorMessage: String?

    @State private var page: OnboardingPage = .home
    @State private var createdSecret: String = ""
    @State private var createMessage: String?
    @State private var restoreInput: String = ""
    @State private var pendingSecret: String = ""
    @State private var pendingProfile: String = ""

    var body: some View {
        let signInVM = authVM.signInViewModel

        VStack(spacing: 16) {
            Text("Welcome to Taskify")
                .font(.title2.bold())

            switch page {
            case .home:
                VStack(spacing: 10) {
                    Button("Sign in with nsec") { page = .signIn }
                        .buttonStyle(.borderedProminent)
                        .frame(maxWidth: .infinity)

                    Button("Create new login") {
                        createMessage = nil
                        if createdSecret.isEmpty { createdSecret = generateSecretKeyHex() }
                        page = .create
                    }
                    .buttonStyle(.bordered)
                    .frame(maxWidth: .infinity)

                    Button("Restore from backup") { page = .restore }
                        .buttonStyle(.bordered)
                        .frame(maxWidth: .infinity)
                }

            case .signIn:
                VStack(alignment: .leading, spacing: 12) {
                    Text("Sign in with nsec")
                        .font(.headline)

                    TextField("nsec1... or 64-character key", text: Binding(
                        get: { signInVM.secretKeyInput },
                        set: { signInVM.secretKeyInput = $0 }
                    ))
                    .textFieldStyle(.roundedBorder)

                    TextField("Profile name (optional)", text: Binding(
                        get: { signInVM.profileName },
                        set: { signInVM.profileName = $0 }
                    ))
                    .textFieldStyle(.roundedBorder)

                    if let msg = signInVM.errorMessage, !msg.isEmpty {
                        Text(msg)
                            .font(.footnote)
                            .foregroundStyle(.red)
                    }

                    HStack {
                        Button("Back") { page = .home }
                            .buttonStyle(.bordered)
                        Button("Continue") {
                            pendingSecret = signInVM.secretKeyInput
                            pendingProfile = signInVM.profileName
                            page = .notifications
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(signInVM.secretKeyInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }

            case .create:
                VStack(alignment: .leading, spacing: 12) {
                    Text("Create new login")
                        .font(.headline)

                    Text("This private key is your login. Save it in a password manager.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)

                    TextEditor(text: $createdSecret)
                        .frame(minHeight: 90)
                        .font(.system(.footnote, design: .monospaced))
                        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.secondary.opacity(0.25)))

                    HStack {
                        Button("Copy") {
                            #if canImport(UIKit)
                            UIPasteboard.general.string = createdSecret
                            #endif
                            createMessage = "Key copied"
                        }
                        .buttonStyle(.bordered)

                        Button("Use this key") {
                            pendingSecret = createdSecret
                            pendingProfile = signInVM.profileName
                            page = .notifications
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(createdSecret.isEmpty)
                    }

                    if let createMessage {
                        Text(createMessage)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }

                    Button("Back") { page = .home }
                        .buttonStyle(.bordered)
                }

            case .restore:
                VStack(alignment: .leading, spacing: 12) {
                    Text("Restore from backup")
                        .font(.headline)

                    Text("Paste your nsec or 64-character key to restore this account.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)

                    TextField("nsec1... or 64-character key", text: $restoreInput)
                        .textFieldStyle(.roundedBorder)

                    HStack {
                        Button("Back") { page = .home }
                            .buttonStyle(.bordered)
                        Button("Continue") {
                            pendingSecret = restoreInput
                            pendingProfile = signInVM.profileName
                            page = .notifications
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(restoreInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }

            case .notifications:
                VStack(alignment: .leading, spacing: 12) {
                    Text("Enable reminder notifications?")
                        .font(.headline)

                    Text("Taskify only sends reminders you create. You can change this later in Settings.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)

                    if let msg = signInVM.errorMessage, !msg.isEmpty {
                        Text(msg)
                            .font(.footnote)
                            .foregroundStyle(.red)
                    }

                    HStack {
                        Button("Not now") {
                            submitPending(signInVM)
                        }
                        .buttonStyle(.bordered)

                        Button(signInVM.isSubmitting ? "Enabling..." : "Enable notifications") {
                            submitPending(signInVM)
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(signInVM.isSubmitting)
                    }
                }
            }
        }
        .onAppear { signInVM.applyExternalError(errorMessage) }
        .onChange(of: errorMessage) { _, newValue in signInVM.applyExternalError(newValue) }
        .padding(24)
        .frame(maxWidth: 520)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.black.opacity(0.02))
    }

    private func submitPending(_ signInVM: SignInViewModel) {
        signInVM.secretKeyInput = pendingSecret
        signInVM.profileName = pendingProfile
        _ = signInVM.submit()
    }

    private func generateSecretKeyHex() -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        return bytes.map { String(format: "%02x", $0) }.joined()
    }
}
