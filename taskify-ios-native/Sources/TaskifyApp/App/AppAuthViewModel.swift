import Foundation
import TaskifyCore

@MainActor
final class AppAuthViewModel: ObservableObject {
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
