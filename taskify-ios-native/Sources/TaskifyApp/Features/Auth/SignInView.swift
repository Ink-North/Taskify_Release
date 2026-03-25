import SwiftUI

struct SignInView: View {
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
