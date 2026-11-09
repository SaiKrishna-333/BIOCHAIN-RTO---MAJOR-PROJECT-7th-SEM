// didService.js
// Service for generating and managing Decentralized Identifiers (DIDs)
// Uses did:ethr method for Ethereum-based DIDs

import { ethers } from "ethers";
import crypto from "crypto";

// DID method prefix
const DID_METHOD = "did:biochain";
const DID_ETHR_METHOD = "did:ethr";

/**
 * Generate a new DID for a user
 * Creates a DID based on Ethereum address or generates a new one
 * @param {string} userId - MongoDB user ID
 * @param {string} role - User role (owner, dealer, rto, police, admin)
 * @param {string} blockchainAddress - Optional existing blockchain address
 * @returns {Object} - DID document and metadata
 */
export const generateDID = async (userId, role, blockchainAddress = null) => {
    try {
        // Generate Ethereum wallet if no address provided
        let address = blockchainAddress;
        let privateKey = null;

        if (!address) {
            const wallet = ethers.Wallet.createRandom();
            address = wallet.address;
            privateKey = wallet.privateKey;
        }

        // Create DID identifier
        const did = `${DID_ETHR_METHOD}:${address}`;

        // Generate verification method ID
        const verificationMethodId = `${did}#keys-1`;

        // Create DID document
        const didDocument = {
            "@context": [
                "https://www.w3.org/ns/did/v1",
                "https://identity.foundation/EcdsaSecp256k1RecoverySignature2020/lds-ecdsa-secp256k1-recovery2020-0.0.jsonld"
            ],
            id: did,
            verificationMethod: [
                {
                    id: verificationMethodId,
                    type: "EcdsaSecp256k1RecoveryMethod2020",
                    controller: did,
                    blockchainAccountId: `eip155:1:${address}`
                }
            ],
            authentication: [verificationMethodId],
            assertionMethod: [verificationMethodId],
            service: [
                {
                    id: `${did}#biochain-profile`,
                    type: "BioChainProfile",
                    serviceEndpoint: {
                        userId,
                        role,
                        platform: "BioChain RTO"
                    }
                }
            ]
        };

        // Generate unique identifier for BioChain system
        const biochainDid = `${DID_METHOD}:${role}:${crypto.createHash('sha256').update(userId + address).digest('hex').substring(0, 32)}`;

        return {
            did,
            biochainDid,
            didDocument,
            address,
            privateKey, // Only returned once - must be stored securely by caller
            createdAt: new Date().toISOString()
        };
    } catch (error) {
        console.error("Error generating DID:", error.message);
        throw new Error("Failed to generate DID");
    }
};

/**
 * Resolve a DID to its DID document
 * @param {string} did - DID to resolve
 * @returns {Object} - DID document
 */
export const resolveDID = (did) => {
    try {
        if (did.startsWith(DID_ETHR_METHOD)) {
            // Extract Ethereum address from DID
            const address = did.split(":")[2];

            if (!ethers.isAddress(address)) {
                throw new Error("Invalid Ethereum address in DID");
            }

            const verificationMethodId = `${did}#keys-1`;

            return {
                "@context": [
                    "https://www.w3.org/ns/did/v1",
                    "https://identity.foundation/EcdsaSecp256k1RecoverySignature2020/lds-ecdsa-secp256k1-recovery2020-0.0.jsonld"
                ],
                id: did,
                verificationMethod: [
                    {
                        id: verificationMethodId,
                        type: "EcdsaSecp256k1RecoveryMethod2020",
                        controller: did,
                        blockchainAccountId: `eip155:1:${address}`
                    }
                ],
                authentication: [verificationMethodId],
                assertionMethod: [verificationMethodId]
            };
        }

        if (did.startsWith(DID_METHOD)) {
            // BioChain-specific DID resolution
            const parts = did.split(":");
            const role = parts[2];

            return {
                "@context": ["https://www.w3.org/ns/did/v1"],
                id: did,
                verificationMethod: [],
                service: [
                    {
                        id: `${did}#biochain-role`,
                        type: "BioChainRole",
                        serviceEndpoint: { role }
                    }
                ]
            };
        }

        throw new Error("Unsupported DID method");
    } catch (error) {
        console.error("Error resolving DID:", error.message);
        throw error;
    }
};

/**
 * Sign a credential with a DID
 * @param {Object} credential - Credential to sign
 * @param {string} privateKey - Private key for signing
 * @param {string} did - Issuer DID
 * @returns {Object} - Verifiable credential
 */
export const signCredential = async (credential, privateKey, did) => {
    try {
        const wallet = new ethers.Wallet(privateKey);

        // Create credential hash
        const credentialString = JSON.stringify(credential);
        const hash = crypto.createHash('sha256').update(credentialString).digest('hex');

        // Sign the hash
        const signature = await wallet.signMessage(hash);

        return {
            ...credential,
            proof: {
                type: "EcdsaSecp256k1Signature2019",
                created: new Date().toISOString(),
                proofPurpose: "assertionMethod",
                verificationMethod: `${did}#keys-1`,
                jws: signature
            }
        };
    } catch (error) {
        console.error("Error signing credential:", error.message);
        throw new Error("Failed to sign credential");
    }
};

/**
 * Verify a credential signature
 * @param {Object} verifiableCredential - Credential with proof
 * @returns {boolean} - Whether signature is valid
 */
export const verifyCredential = async (verifiableCredential) => {
    try {
        const { proof, ...credential } = verifiableCredential;

        // Extract address from verification method
        const did = proof.verificationMethod.split("#")[0];
        const address = did.split(":")[2];

        // Recreate hash
        const credentialString = JSON.stringify(credential);
        const hash = crypto.createHash('sha256').update(credentialString).digest('hex');

        // Recover signer address from signature
        const recoveredAddress = ethers.verifyMessage(hash, proof.jws);

        return recoveredAddress.toLowerCase() === address.toLowerCase();
    } catch (error) {
        console.error("Error verifying credential:", error.message);
        return false;
    }
};

/**
 * Create a vehicle ownership credential
 * @param {Object} vehicle - Vehicle data
 * @param {Object} owner - Owner data with DID
 * @returns {Object} - Ownership credential
 */
export const createOwnershipCredential = (vehicle, owner) => {
    return {
        "@context": [
            "https://www.w3.org/2018/credentials/v1",
            "https://biochain.rto/credentials/ownership/v1"
        ],
        id: `urn:uuid:${crypto.randomUUID()}`,
        type: ["VerifiableCredential", "VehicleOwnershipCredential"],
        issuer: owner.did,
        issuanceDate: new Date().toISOString(),
        credentialSubject: {
            id: owner.did,
            vehicle: {
                registrationNumber: vehicle.regNumber,
                chassisNumber: vehicle.chassisNumber,
                engineNumber: vehicle.engineNumber,
                make: vehicle.make,
                model: vehicle.model,
                year: vehicle.year
            },
            ownershipType: "registered_owner",
            issuedBy: "BioChain RTO"
        }
    };
};

/**
 * Create a transfer authorization credential
 * @param {Object} vehicle - Vehicle data
 * @param {Object} seller - Seller data with DID
 * @param {Object} buyer - Buyer data with DID
 * @returns {Object} - Transfer authorization credential
 */
export const createTransferAuthorizationCredential = (vehicle, seller, buyer) => {
    return {
        "@context": [
            "https://www.w3.org/2018/credentials/v1",
            "https://biochain.rto/credentials/transfer/v1"
        ],
        id: `urn:uuid:${crypto.randomUUID()}`,
        type: ["VerifiableCredential", "TransferAuthorizationCredential"],
        issuer: seller.did,
        issuanceDate: new Date().toISOString(),
        credentialSubject: {
            id: seller.did,
            vehicle: {
                registrationNumber: vehicle.regNumber
            },
            transferTo: buyer.did,
            transferType: "sale",
            authorized: true
        }
    };
};

/**
 * Create an RTO officer authorization credential
 * @param {Object} officer - Officer data
 * @returns {Object} - RTO authorization credential
 */
export const createRTOAuthorizationCredential = (officer) => {
    return {
        "@context": [
            "https://www.w3.org/2018/credentials/v1",
            "https://biochain.rto/credentials/rto/v1"
        ],
        id: `urn:uuid:${crypto.randomUUID()}`,
        type: ["VerifiableCredential", "RTOOfficerCredential"],
        issuer: "did:biochain:system",
        issuanceDate: new Date().toISOString(),
        credentialSubject: {
            id: officer.did,
            role: "rto_officer",
            authorizedActions: ["approve_registration", "approve_transfer", "verify_documents"],
            department: "Regional Transport Office"
        }
    };
};

/**
 * Generate DID for a deceased owner (inheritance scenario)
 * @param {string} originalOwnerId - Original owner MongoDB ID
 * @param {string} deathCertificateNumber - Death certificate reference
 * @returns {Object} - Deceased owner DID info
 */
export const generateDeceasedOwnerDID = (originalOwnerId, deathCertificateNumber) => {
    const deceasedHash = crypto.createHash('sha256')
        .update(originalOwnerId + deathCertificateNumber + Date.now())
        .digest('hex')
        .substring(0, 32);

    return {
        did: `${DID_METHOD}:deceased:${deceasedHash}`,
        status: "DECEASED",
        deathCertificateNumber,
        markedAt: new Date().toISOString()
    };
};

/**
 * Validate a DID format
 * @param {string} did - DID string to validate
 * @returns {boolean} - Whether format is valid
 */
export const isValidDID = (did) => {
    if (!did || typeof did !== "string") return false;

    // Basic DID format validation
    const didRegex = /^did:[a-z0-9]+:[a-zA-Z0-9_.-]+$/;
    return didRegex.test(did);
};

/**
 * Extract role from BioChain DID
 * @param {string} did - BioChain DID
 * @returns {string|null} - Role or null
 */
export const getRoleFromDID = (did) => {
    if (!did.startsWith(DID_METHOD)) return null;

    const parts = did.split(":");
    return parts.length >= 3 ? parts[2] : null;
};
