/// KeychainStore.swift
/// Secure storage for Taskify profile credentials (nsec, profiles list).
/// Uses iOS Keychain Services via Security framework.

import Foundation
import Security

public enum KeychainStore {

    private static let service = "ai.taskify.ios"

    // MARK: - Profile storage

    /// Saves the active profile to the Keychain.
    public static func saveProfile(_ profile: TaskifyProfile) throws {
        let data = try JSONEncoder().encode(profile)
        try set(data, key: "profile:\(profile.name)")
        try set(Data(profile.name.utf8), key: "active_profile")
    }

    /// Loads the active profile from the Keychain.
    public static func loadActiveProfile() throws -> TaskifyProfile? {
        guard let nameData = try? get(key: "active_profile"),
              let name = String(data: nameData, encoding: .utf8),
              let data = try? get(key: "profile:\(name)") else { return nil }
        return try JSONDecoder().decode(TaskifyProfile.self, from: data)
    }

    /// Returns all saved profile names.
    public static func allProfileNames() throws -> [String] {
        guard let data = try? get(key: "profile_names") else { return [] }
        return (try? JSONDecoder().decode([String].self, from: data)) ?? []
    }

    public static func saveProfileNames(_ names: [String]) throws {
        let data = try JSONEncoder().encode(names)
        try set(data, key: "profile_names")
    }

    /// Deletes a profile from the Keychain.
    public static func deleteProfile(name: String) throws {
        try delete(key: "profile:\(name)")
        var names = (try? allProfileNames()) ?? []
        names.removeAll { $0 == name }
        try saveProfileNames(names)
    }

    // MARK: - Low-level Keychain operations

    public static func set(_ data: Data, key: String) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
        let update: [String: Any] = [kSecValueData as String: data]
        let status = SecItemUpdate(query as CFDictionary, update as CFDictionary)
        if status == errSecItemNotFound {
            var addQuery = query
            addQuery[kSecValueData as String] = data
            let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
            guard addStatus == errSecSuccess else {
                throw KeychainError.writeFailed(addStatus)
            }
        } else if status != errSecSuccess {
            throw KeychainError.writeFailed(status)
        }
    }

    public static func get(key: String) throws -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw KeychainError.readFailed(status) }
        return result as? Data
    }

    public static func delete(key: String) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError.deleteFailed(status)
        }
    }
}

// MARK: - Errors

public enum KeychainError: Error, LocalizedError {
    case writeFailed(OSStatus)
    case readFailed(OSStatus)
    case deleteFailed(OSStatus)

    public var errorDescription: String? {
        switch self {
        case .writeFailed(let s): return "Keychain write failed: \(s)"
        case .readFailed(let s): return "Keychain read failed: \(s)"
        case .deleteFailed(let s): return "Keychain delete failed: \(s)"
        }
    }
}
