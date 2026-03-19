/// Secp256k1Helpers.swift
/// Wraps swift-secp256k1 (P256K product) for Nostr key operations.

import Foundation
import P256K
import CryptoKit

public enum Secp256k1Helpers {

    /// Derives the compressed public key and a 32-byte NIP-44 conversation key from a 32-byte private key.
    public static func derivePublicKeyAndConversationKey(
        privateKeyBytes: Data
    ) throws -> (publicKey: Data, conversationKey: Data) {
        // Compressed signing key (33-byte pubkey)
        let signingKey = try P256K.Signing.PrivateKey(dataRepresentation: privateKeyBytes)
        let compressedPub = signingKey.publicKey.dataRepresentation

        // ECDH shared secret (compressed). Hash to 32 bytes for stable conversation key material.
        // This mirrors libsecp256k1 ECDH derivation flow used by nip44 conversation key helpers.
        let kaPriv = try P256K.KeyAgreement.PrivateKey(dataRepresentation: privateKeyBytes)
        let shared = try kaPriv.sharedSecretFromKeyAgreement(with: kaPriv.publicKey)
        let sharedData = shared.withUnsafeBytes { Data($0) }
        let conv = SHA256.hash(data: sharedData)
        let conversationKey = Data(conv)

        return (compressedPub, conversationKey)
    }

    /// Returns x-only pubkey (32 bytes) from private key.
    public static func xOnlyPublicKey(from privateKeyBytes: Data) throws -> Data {
        let sk = try P256K.Schnorr.PrivateKey(dataRepresentation: privateKeyBytes)
        return Data(sk.xonly.bytes)
    }

    /// Signs event id bytes (32-byte digest) with Schnorr.
    public static func schnorrSign(message: Data, privateKeyBytes: Data) throws -> Data {
        let sk = try P256K.Schnorr.PrivateKey(dataRepresentation: privateKeyBytes)
        var msg = [UInt8](message)
        let sig = try sk.signature(message: &msg, auxiliaryRand: nil, strict: false)
        return sig.dataRepresentation
    }

    /// Verifies Schnorr signature over message bytes.
    public static func schnorrVerify(
        signature: Data,
        message: Data,
        publicKeyBytes: Data
    ) throws -> Bool {
        let sig = try P256K.Schnorr.SchnorrSignature(dataRepresentation: signature)
        let xonly = P256K.Schnorr.XonlyKey(dataRepresentation: publicKeyBytes)
        var msg = [UInt8](message)
        return xonly.isValid(sig, for: &msg)
    }
}
