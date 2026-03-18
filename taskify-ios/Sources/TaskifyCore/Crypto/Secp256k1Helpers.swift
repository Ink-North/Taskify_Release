/// Secp256k1Helpers.swift
/// Wraps the swift-secp256k1 package for Nostr key operations.
///
/// NIP-44 conversation key for a self-owned board key:
///   conversationKey = ECDH(sk, pk)  — same key on both sides (secp256k1 x-only shared point)
///
/// This mirrors the NIP-44 spec:
///   shared_x = secp256k1_ecdh(private_key, public_key)  → 32 bytes x-coordinate

import Foundation
import secp256k1

public enum Secp256k1Helpers {

    /// Derives the compressed public key and NIP-44 conversation key from a 32-byte private key.
    /// - Parameter privateKeyBytes: 32 raw bytes of secp256k1 private key
    /// - Returns: (compressedPublicKey: 33 bytes, conversationKey: 32 bytes)
    public static func derivePublicKeyAndConversationKey(
        privateKeyBytes: Data
    ) throws -> (publicKey: Data, conversationKey: Data) {
        let privKey = try secp256k1.Signing.PrivateKey(
            dataRepresentation: privateKeyBytes,
            format: .uncompressed
        )
        // Compressed public key (33 bytes: 02/03 prefix + 32 bytes x)
        let compressedPub = Data(privKey.publicKey.dataRepresentation)

        // NIP-44 conversation key: secp256k1 ECDH → x-coordinate only (32 bytes)
        // For board self-encryption, sk × pk(sk) → the shared point's x coordinate
        let xOnlyPub = privKey.publicKey.xonly
        let conversationKey = try secp256k1.KeyAgreement.PrivateKey(
            dataRepresentation: privateKeyBytes,
            format: .uncompressed
        ).sharedSecretFromKeyAgreement(with: xOnlyPub.publicKey)
            .withUnsafeBytes { Data(Array($0).prefix(32)) }

        return (compressedPub, conversationKey)
    }

    /// Returns the 32-byte x-only public key (Schnorr / Nostr format).
    public static func xOnlyPublicKey(from privateKeyBytes: Data) throws -> Data {
        let privKey = try secp256k1.Signing.PrivateKey(
            dataRepresentation: privateKeyBytes,
            format: .uncompressed
        )
        return Data(privKey.publicKey.xonly.dataRepresentation)
    }

    /// Signs an event payload with a secp256k1 private key (Schnorr).
    /// Returns the 64-byte Schnorr signature.
    public static func schnorrSign(message: Data, privateKeyBytes: Data) throws -> Data {
        let privKey = try secp256k1.Signing.PrivateKey(
            dataRepresentation: privateKeyBytes,
            format: .uncompressed
        )
        let signature = try privKey.signature(for: message)
        return Data(signature.dataRepresentation)
    }

    /// Verifies a Schnorr signature.
    public static func schnorrVerify(
        signature: Data,
        message: Data,
        publicKeyBytes: Data
    ) throws -> Bool {
        let sig = try secp256k1.Signing.SchnorrSignature(dataRepresentation: signature)
        let pubKey = try secp256k1.Signing.PublicKey(
            xonlyRepresentation: publicKeyBytes,
            format: .uncompressed
        )
        return pubKey.isValidSignature(sig, for: message)
    }
}
