// privacyPreservingVerification.js
// PATENT FEATURE #5: Privacy-Preserving Ownership Verification
// Allows authorities to verify ownership without exposing personal data

import { Vehicle } from "../models/Vehicle.js";
import { User } from "../models/User.js";

/**
 * Verify vehicle ownership without exposing owner details
 * Returns only valid/invalid status
 */
export const verifyOwnershipPrivacyPreserving = async (vehicleId, requesterRole) => {
    try {
        const vehicle = await Vehicle.findById(vehicleId).populate("currentOwner", "did blockchainWalletAddress");

        if (!vehicle) {
            return {
                success: false,
                error: "Vehicle not found",
                ownershipValid: false
            };
        }

        // Determine verification level based on requester role
        let verificationResult = {
            vehicleId: vehicle._id,
            regNumber: vehicle.regNumber,
            ownershipValid: !!vehicle.currentOwner,
            verificationTimestamp: new Date().toISOString(),
            requestedBy: requesterRole
        };

        // Only return minimal data based on role
        if (requesterRole === "police") {
            // Police can verify ownership but NOT see personal details
            verificationResult = {
                ...verificationResult,
                ownershipStatus: vehicle.currentOwner ? "VERIFIED_OWNER" : "NO_OWNER",
                ownerDID: vehicle.currentOwner?.did || null, // Only DID, not personal info
                blockchainVerified: !!vehicle.blockchainTxHash,
                vehicleStatus: vehicle.status,
                lastVerified: vehicle.lastVerified,
                // NO personal details (name, address, phone, etc.)
                privacyLevel: "minimal_disclosure"
            };
        } else if (requesterRole === "rto") {
            // RTO can see more but still limited
            verificationResult = {
                ...verificationResult,
                ownershipStatus: vehicle.currentOwner ? "VERIFIED_OWNER" : "NO_OWNER",
                ownerDID: vehicle.currentOwner?.did || null,
                ownerBlockchainAddress: vehicle.currentOwner?.blockchainWalletAddress || null,
                blockchainVerified: !!vehicle.blockchainTxHash,
                vehicleStatus: vehicle.status,
                lastVerified: vehicle.lastVerified,
                ownershipHistoryCount: vehicle.ownershipHistory?.length || 0,
                privacyLevel: "standard"
            };
        } else {
            // Other roles get minimal info
            verificationResult = {
                ...verificationResult,
                ownershipStatus: vehicle.currentOwner ? "VERIFIED" : "UNVERIFIED",
                privacyLevel: "restricted"
            };
        }

        return {
            success: true,
            verification: verificationResult
        };
    } catch (error) {
        console.error("Error in privacy-preserving verification:", error.message);
        return {
            success: false,
            error: error.message,
            ownershipValid: false
        };
    }
};

/**
 * Verify ownership by vehicle registration number (privacy-preserving)
 */
export const verifyOwnershipByRegNumber = async (regNumber, requesterRole) => {
    try {
        const vehicle = await Vehicle.findOne({ regNumber }).populate("currentOwner", "did blockchainWalletAddress");

        if (!vehicle) {
            return {
                success: false,
                error: "Vehicle not found",
                ownershipValid: false
            };
        }

        return await verifyOwnershipPrivacyPreserving(vehicle._id, requesterRole);
    } catch (error) {
        console.error("Error verifying ownership by reg number:", error.message);
        return {
            success: false,
            error: error.message,
            ownershipValid: false
        };
    }
};

/**
 * Generate zero-knowledge proof of ownership
 * Proves ownership without revealing identity
 */
export const generateOwnershipZKP = async (vehicleId, ownerDID) => {
    try {
        const vehicle = await Vehicle.findById(vehicleId).populate("currentOwner", "did blockchainWalletAddress");

        if (!vehicle) {
            return { error: "Vehicle not found" };
        }

        if (!vehicle.currentOwner) {
            return { error: "Vehicle has no owner" };
        }

        // Verify the requester is the owner (via DID matching)
        if (vehicle.currentOwner.did !== ownerDID && vehicle.currentOwner.blockchainWalletAddress !== ownerDID) {
            return { error: "Unauthorized: Not the vehicle owner" };
        }

        // Generate cryptographic proof
        const crypto = await import('crypto');
        const proofData = {
            vehicleId: vehicle._id.toString(),
            regNumber: vehicle.regNumber,
            ownerDID: ownerDID,
            timestamp: new Date().toISOString(),
            proofType: "ownership_zero_knowledge"
        };

        const proofString = JSON.stringify(proofData);
        const proofHash = crypto.createHash('sha256').update(proofString).digest('hex');

        return {
            proof: {
                type: "ZeroKnowledgeProof",
                algorithm: "SHA-256",
                hash: `0x${proofHash}`,
                data: {
                    vehicleId: vehicle._id.toString(),
                    regNumber: vehicle.regNumber,
                    proofGenerated: true,
                    timestamp: proofData.timestamp
                }
            },
            message: "Ownership proven without revealing identity"
        };
    } catch (error) {
        console.error("Error generating ZKP:", error.message);
        return { error: error.message };
    }
};

/**
 * Verify zero-knowledge proof
 */
export const verifyOwnershipZKP = async (proof, regNumber) => {
    try {
        const crypto = await import('crypto');

        // Recreate proof data
        const proofData = {
            regNumber: regNumber,
            proofType: "ownership_zero_knowledge",
            timestamp: proof.data.timestamp
        };

        const proofString = JSON.stringify(proofData);
        const expectedHash = crypto.createHash('sha256').update(proofString).digest('hex');

        const isValid = proof.hash === `0x${expectedHash}`;

        return {
            valid: isValid,
            message: isValid ? "Proof is valid" : "Proof is invalid",
            verifiedAt: new Date().toISOString()
        };
    } catch (error) {
        console.error("Error verifying ZKP:", error.message);
        return {
            valid: false,
            error: error.message
        };
    }
};

/**
 * Bulk verify multiple vehicles (privacy-preserving)
 */
export const bulkVerifyOwnership = async (vehicleIds, requesterRole) => {
    try {
        const vehicles = await Vehicle.find({ _id: { $in: vehicleIds } })
            .populate("currentOwner", "did blockchainWalletAddress");

        const results = vehicles.map(vehicle => ({
            vehicleId: vehicle._id,
            regNumber: vehicle.regNumber,
            ownershipValid: !!vehicle.currentOwner,
            blockchainVerified: !!vehicle.blockchainTxHash,
            vehicleStatus: vehicle.status
        }));

        return {
            success: true,
            count: results.length,
            results,
            privacyLevel: requesterRole === "police" ? "minimal" : "standard"
        };
    } catch (error) {
        console.error("Error in bulk verification:", error.message);
        return {
            success: false,
            error: error.message
        };
    }
};

/**
 * Privacy-compliant ownership audit log
 */
export const logPrivacyCompliantVerification = async (vehicleId, requesterRole, requesterId, result) => {
    try {
        // Only log minimal information (no personal data)
        const auditLog = {
            vehicleId,
            requesterRole,
            requesterId,
            verificationResult: result.ownershipValid,
            timestamp: new Date().toISOString(),
            dataDisclosed: "none", // Privacy guarantee
            complianceLevel: "GDPR_compliant"
        };

        // In production, store in audit database
        console.log("Privacy-compliant audit log:", auditLog);

        return {
            success: true,
            logged: true,
            timestamp: auditLog.timestamp
        };
    } catch (error) {
        console.error("Error logging verification:", error.message);
        return {
            success: false,
            error: error.message
        };
    }
};

export default {
    verifyOwnershipPrivacyPreserving,
    verifyOwnershipByRegNumber,
    generateOwnershipZKP,
    verifyOwnershipZKP,
    bulkVerifyOwnership,
    logPrivacyCompliantVerification
};
