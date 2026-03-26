import Foundation

public enum ContactsListState: Equatable {
    case loading
    case empty
    case ready
    case error(String)
}

public struct ContactField: Identifiable, Equatable, Sendable {
    public var id: String { key }
    public let key: String
    public let label: String
    public let value: String
    public let multiline: Bool

    public init(key: String, label: String, value: String, multiline: Bool = false) {
        self.key = key
        self.label = label
        self.value = value
        self.multiline = multiline
    }
}

@MainActor
public final class ContactsViewModel: ObservableObject {
    @Published public private(set) var state: ContactsListState = .loading
    @Published public private(set) var contacts: [TaskifyContactRecord] = []
    @Published public private(set) var publicFollows: [TaskifyPublicFollowRecord] = []

    public init() {}

    public func setContacts(_ contacts: [TaskifyContactRecord]) {
        self.contacts = contacts
        state = contacts.isEmpty ? .empty : .ready
    }

    public func setPublicFollows(_ follows: [TaskifyPublicFollowRecord]) {
        publicFollows = follows
    }

    public func setLoading() {
        state = .loading
    }

    public func setError(_ message: String) {
        state = .error(message)
    }

    public func filteredContacts(searchText: String) -> [TaskifyContactRecord] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !query.isEmpty else { return contacts }
        return contacts.filter { contact in
            [
                contact.name,
                contact.displayName ?? "",
                contact.username ?? "",
                contact.address,
                contact.nip05 ?? "",
                contact.npub,
            ]
            .joined(separator: "\n")
            .lowercased()
            .contains(query)
        }
    }

    public func importableFollows(searchText: String = "") -> [TaskifyPublicFollowRecord] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let existingKeys = Set(contacts.compactMap { try? NostrIdentityService.normalizePublicKeyInput($0.npub) })
        return publicFollows.filter { follow in
            guard !existingKeys.contains(follow.pubkey) else { return false }
            guard !query.isEmpty else { return true }
            return [
                follow.petname ?? "",
                follow.username ?? "",
                follow.nip05 ?? "",
                follow.pubkey,
                formatContactNpub(follow.pubkey),
            ]
            .joined(separator: "\n")
            .lowercased()
            .contains(query)
        }
    }

    public func fields(for contact: TaskifyContactRecord) -> [ContactField] {
        let username = formatContactUsername(contact.username)
        let npub = formatContactNpub(contact.npub)
        return [
            !contact.address.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                ? ContactField(key: "lightning", label: "Lightning", value: contact.address)
                : nil,
            !npub.isEmpty
                ? ContactField(key: "npub", label: "Nostr pubkey", value: npub)
                : nil,
            normalizeNip05(contact.nip05) != nil
                ? ContactField(key: "nip05", label: "NIP-05", value: normalizeNip05(contact.nip05) ?? "")
                : nil,
            !username.isEmpty
                ? ContactField(key: "username", label: "Username", value: username)
                : nil,
            !(contact.about ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                ? ContactField(key: "about", label: "About", value: contact.about ?? "", multiline: true)
                : nil,
        ]
        .compactMap { $0 }
    }
}
