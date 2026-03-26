import Foundation

public enum ContactPreferencesStore {
    private static let syncPrefix = "ai.taskify.contacts.sync."
    private static let profilePrefix = "ai.taskify.profile.metadata."

    public static func loadSyncMetadata(npub: String) -> ContactSyncMetadata {
        guard let data = UserDefaults.standard.data(forKey: syncPrefix + npub),
              let decoded = try? JSONDecoder().decode(ContactSyncMetadata.self, from: data) else {
            return ContactSyncMetadata()
        }
        return decoded
    }

    public static func saveSyncMetadata(_ metadata: ContactSyncMetadata, npub: String) {
        guard let data = try? JSONEncoder().encode(metadata) else { return }
        UserDefaults.standard.set(data, forKey: syncPrefix + npub)
    }

    public static func loadProfileMetadata(npub: String) -> TaskifyProfileMetadata {
        guard let data = UserDefaults.standard.data(forKey: profilePrefix + npub),
              let decoded = try? JSONDecoder().decode(TaskifyProfileMetadata.self, from: data) else {
            return TaskifyProfileMetadata()
        }
        return decoded
    }

    public static func saveProfileMetadata(_ metadata: TaskifyProfileMetadata, npub: String) {
        guard let data = try? JSONEncoder().encode(metadata) else { return }
        UserDefaults.standard.set(data, forKey: profilePrefix + npub)
    }
}
