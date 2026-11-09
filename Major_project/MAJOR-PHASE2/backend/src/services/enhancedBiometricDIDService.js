// enhancedBiometricDIDService.js
// PATENT FEATURE #1: Biometric + DID Binding Protocol
// Converts biometric identity into secure decentralized identifiers

import crypto from "crypto";
import { ethers } from "ethers";

const DID_METHOD = "did:biochain";
const DID_ETHR_METHOD = "did:ethr";

/**
 * Generate cryptographic hash from biometric template
 * Creates a unique, irreversible hash from fingerprint data
 */
export const generateBiometricHash = (biometricTemplate) => {
    try {
        const hash = crypto
            .createHash('sha256')
            .update(biometricTemplate + process.env.BIOMETRIC_SALT || 'biochain-salt-2024')
            .digest('hex');

        return `0x${hash}`;
    } catch (error) {
        console.error("Error generating biometric hash:", error.message);
        throw new Error("Failed to generate biometric hash");
    }
};

/**
 * Create biometric-bound DID
 * Links biometric identity with decentralized identifier
 */
export const createBiometricBoundDID = async (userId, role, biometricTemplate) => {
    try {
        // Generate Ethereum wallet
        const wallet = ethers.Wallet.createRandom();
        const address = wallet.address;

        // Create biometric hash
        const biometricHash = generateBiometricHash(biometricTemplate);

        // Create DID identifier
        const did = `${DID_ETHR_METHOD}:${address}`;

        // Create BioChain-specific DID with biometric binding
        const biochainDid = `${DID_METHOD}:${role}:${crypto
            .createHash('sha256')
            .update(userId + biometricHash + address)
            .digest('hex')
            .substring(0, 32)}`;

        // Create enhanced DID document with biometric verification method
        const didDocument = {
            "@context": [
                "https://www.w3.org/ns/did/v1",
                "https://identity.foundation/EcdsaSecp256k1RecoverySignature2020/lds-ecdsa-secp256k1-recovery2020-0.0.jsonld"
            ],
            id: did,
            verificationMethod: [
                {
                    id: `${did}#keys-1`,
                    type: "EcdsaSecp256k1RecoveryMethod2020",
                    controller: did,
                    blockchainAccountId: `eip155:1:${address}`
                },
                {
                    id: `${did}#biometric-key`,
                    type: "BiometricVerificationMethod2024",
                    controller: did,
                    biometricHash: biometricHash,
                    biometricType: "fingerprint"
                }
            ],
            authentication: [`${did}#keys-1`],
            assertionMethod: [`${did}#keys-1`, `${did}#biometric-key`],
            service: [
                {
                    id: `${did}#biochain-profile`,
                    type: "BioChainProfile",
                    serviceEndpoint: {
                        userId,
                        role,
                        platform: "BioChain RTO",
                        biometricBound: true,
                        createdAt: new Date().toISOString()
                    }
                }
            ]
        };

        return {
            did,
            biochainDid,
            didDocument,
            address,
            privateKey: wallet.privateKey,
            biometricHash,
            createdAt: new Date().toISOString(),
            biometricBound: true
        };
    } catch (error) {
        console.error("Error creating biometric-bound DID:", error.message);
        throw new Error("Failed to create biometric-bound DID");
    }
};

/**
 * Verify biometric against stored DID
 * Ensures biometric matches the DID owner
 */
export const verifyBiometricAgainstDID = (biometricTemplate, didDocument) => {
    try {
        const biometricMethod = didDocument.verificationMethod.find(
            m => m.type === "BiometricVerificationMethod2024"
        );

        if (!biometricMethod) {
            return { success: false, message: "No biometric verification method found" };
        }

        const inputHash = generateBiometricHash(biometricTemplate);
        const matches = inputHash === biometricMethod.biometricHash;

        return {
            success: matches,
            message: matches ? "Biometric verification successful" : "Biometric verification failed"
        };
    } catch (error) {
        console.error("Error verifying biometric against DID:", error.message);
        return { success: false, message: "Verification error" };
    }
};

/**
 * Create biometric-signed credential
 * Uses biometric hash as part of credential signing
 */
export const createBiometricSignedCredential = async (credentialData, privateKey, did, biometricHash) => {
    try {
        const wallet = new ethers.Wallet(privateKey);

        // Include biometric hash in credential
        const enhancedCredential = {
            ...credentialData,
            biometricHash,
            biometricVerification: true
        };

        // Create credential hash with biometric
        const credentialString = JSON.stringify(enhancedCredential);
        const hash = crypto.createHash('sha256').update(credentialString).digest('hex');

        // Sign with wallet
        const signature = await wallet.signMessage(hash);

        return {
            ...enhancedCredential,
            proof: {
                type: "EcdsaSecp256k1Signature2019",
                created: new Date().toISOString(),
                proofPurpose: "assertionMethod",
                verificationMethod: `${did}#keys-1`,
                jws: signature,
                biometricBound: true
            }
        };
    } catch (error) {
        console.error("Error creating biometric-signed credential:", error.message);
        throw new Error("Failed to create biometric-signed credential");
    }
};

/**
 * Revoke biometric-bound DID
 * Used when biometric is compromised
 */
export const revokeBiometricDID = (did, reason) => {
    return {
        did,
        status: "revoked",
        reason,
        revokedAt: new Date().toISOString()
    };
};

export default {
    generateBiometricHash,
    createBiometricBoundDID,
    verifyBiometricAgainstDID,
    createBiometricSignedCredential,
    revokeBiometricDID
};
