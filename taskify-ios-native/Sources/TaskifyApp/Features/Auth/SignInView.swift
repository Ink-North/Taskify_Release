import SwiftUI
import Security

private enum OnboardingPage {
    case home
    case signIn
    case create
}

struct SignInView: View {
    @EnvironmentObject private var authVM: AppAuthViewModel
    let errorMessage: String?

    @State private var page: OnboardingPage = .home
    @State private var createdSecret: String = ""
    @State private var createMessage: String?

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

                    Button("Restore from backup") {}
                        .buttonStyle(.bordered)
                        .frame(maxWidth: .infinity)
                        .disabled(true)

                    Text("Restore flow coming in next parity slice")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
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
                        Button("Continue") { _ = signInVM.submit() }
                            .buttonStyle(.borderedProminent)
                            .disabled(!signInVM.canSubmit)
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
                            signInVM.secretKeyInput = createdSecret
                            _ = signInVM.submit()
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
            }
        }
        .onAppear { signInVM.applyExternalError(errorMessage) }
        .onChange(of: errorMessage) { _, newValue in signInVM.applyExternalError(newValue) }
        .padding(24)
        .frame(maxWidth: 520)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.black.opacity(0.02))
    }

    private func generateSecretKeyHex() -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        return bytes.map { String(format: "%02x", $0) }.joined()
    }
}
