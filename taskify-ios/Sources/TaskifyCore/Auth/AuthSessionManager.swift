import Foundation

public enum AuthState: Equatable {
    case signedOut
    case importing
    case signedIn(TaskifyProfile)
    case error(String)
}

@MainActor
public final class AuthSessionManager {
    public private(set) var state: AuthState = .signedOut

    private let loadActiveProfileFn: () throws -> TaskifyProfile?
    private let saveProfileFn: (TaskifyProfile) throws -> Void
    private let importIdentityFn: (String) throws -> NostrIdentity

    public init(
        loadActiveProfile: @escaping () throws -> TaskifyProfile?,
        saveProfile: @escaping (TaskifyProfile) throws -> Void,
        importIdentity: @escaping (String) throws -> NostrIdentity
    ) {
        self.loadActiveProfileFn = loadActiveProfile
        self.saveProfileFn = saveProfile
        self.importIdentityFn = importIdentity
    }

    public func bootstrap() {
        do {
            if let profile = try loadActiveProfileFn() {
                state = .signedIn(profile)
            } else {
                state = .signedOut
            }
        } catch {
            state = .error("Unable to load profile.")
        }
    }

    public func signIn(secretKeyInput: String, profileName: String, relays: [String]) {
        state = .importing
        do {
            let identity = try importIdentityFn(secretKeyInput)
            let profile = TaskifyProfile(
                name: profileName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "Default" : profileName.trimmingCharacters(in: .whitespacesAndNewlines),
                nsecHex: identity.nsecHex,
                npub: identity.npub,
                relays: relays,
                boards: []
            )
            try saveProfileFn(profile)
            state = .signedIn(profile)
        } catch {
            state = .error("Unable to sign in. Please check your private key.")
        }
    }

    public func signOut() {
        state = .signedOut
    }
}
