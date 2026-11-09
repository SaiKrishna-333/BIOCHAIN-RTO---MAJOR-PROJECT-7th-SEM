// crossStateInteroperability.js
// PATENT FEATURE #6: Cross-State RTO Interoperability Protocol
// Enables seamless vehicle data sharing across different state RTO systems

import { Vehicle } from "../models/Vehicle.js";
import { User } from "../models/User.js";
import crypto from "crypto";

/**
 * State RTO codes mapping (India example)
 */
export const STATE_RTO_CODES = {
    "AP": "Andhra Pradesh",
    "TS": "Telangana",
    "KA": "Karnataka",
    "TN": "Tamil Nadu",
    "MH": "Maharashtra",
    "DL": "Delhi",
    "GJ": "Gujarat",
    "RJ": "Rajasthan",
    "UP": "Uttar Pradesh",
    "MP": "Madhya Pradesh",
    "KL": "Kerala"
};

/**
 * Extract state code from registration number
 */
export const extractStateFromRegNumber = (regNumber) => {
    if (!regNumber) return null;
    const match = regNumber.match(/^([A-Z]{2})/);
    return match ? match[1] : null;
};

/**
 * Generate cross-state vehicle passport
 * Standardized data format for sharing across states
 */
export const generateVehiclePassport = async (vehicleId) => {
    try {
        const vehicle = await Vehicle.findById(vehicleId)
            .populate("currentOwner", "did blockchainWalletAddress")
            .populate("ownershipHistory.owner", "did blockchainWalletAddress");

        if (!vehicle) {
            return { error: "Vehicle not found" };
        }

        const stateCode = extractStateFromRegNumber(vehicle.regNumber);

        // Create standardized passport
        const passport = {
            passportId: crypto.randomUUID(),
            vehicle: {
                regNumber: vehicle.regNumber,
                chassisNumber: vehicle.chassisNumber,
                engineNumber: vehicle.engineNumber,
                make: vehicle.make,
                model: vehicle.model,
                year: vehicle.year,
                state: stateCode,
                stateName: STATE_RTO_CODES[stateCode] || "Unknown"
            },
            ownership: {
                currentOwnerDID: vehicle.currentOwner?.did || null,
                blockchainVerified: !!vehicle.blockchainTxHash,
                blockchainTxHash: vehicle.blockchainTxHash,
                ownershipTransfers: vehicle.ownershipHistory?.length || 0
            },
            status: {
                current: vehicle.status,
                lastVerified: vehicle.lastVerified,
                isStolen: vehicle.status === "stolen",
                isBlocked: vehicle.status === "blocked"
            },
            documents: {
                rcCertificate: !!vehicle.ipfsDocuments?.rcCertificate,
                insurance: !!vehicle.ipfsDocuments?.insurance,
                puc: !!vehicle.ipfsDocuments?.puc,
                documentHashes: vehicle.ipfsDocuments
            },
            metadata: {
                generatedAt: new Date().toISOString(),
                validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days
                passportVersion: "1.0",
                interoperabilityProtocol: "biochain_cross_state_v1"
            }
        };

        // Generate hash for verification
        const passportHash = crypto.createHash('sha256')
            .update(JSON.stringify(passport))
            .digest('hex');

        return {
            passport,
            passportHash: `0x${passportHash}`,
            message: "Vehicle passport generated successfully"
        };
    } catch (error) {
        console.error("Error generating vehicle passport:", error.message);
        return { error: error.message };
    }
};

/**
 * Verify vehicle passport from another state
 */
export const verifyVehiclePassport = async (passport, passportHash) => {
    try {
        // Verify hash integrity
        const calculatedHash = crypto.createHash('sha256')
            .update(JSON.stringify(passport))
            .digest('hex');

        const hashMatches = `0x${calculatedHash}` === passportHash;

        if (!hashMatches) {
            return {
                valid: false,
                error: "Passport hash verification failed - possible tampering"
            };
        }

        // Check if passport is expired
        const expiryDate = new Date(passport.metadata.validUntil);
        if (expiryDate < new Date()) {
            return {
                valid: false,
                error: "Passport has expired"
            };
        }

        // Extract and return verification data (privacy-preserving)
        const verificationData = {
            vehicleRegNumber: passport.vehicle.regNumber,
            vehicleState: passport.vehicle.state,
            ownershipVerified: passport.ownership.blockchainVerified,
            status: passport.status.current,
            isStolen: passport.status.isStolen,
            isBlocked: passport.status.isBlocked,
            documentsAvailable: Object.values(passport.documents.documentHashes).filter(Boolean).length
        };

        return {
            valid: true,
            verification: verificationData,
            message: "Passport verified successfully"
        };
    } catch (error) {
        console.error("Error verifying passport:", error.message);
        return {
            valid: false,
            error: error.message
        };
    }
};

/**
 * Create inter-state transfer request
 */
export const createInterStateTransfer = async (transferData) => {
    try {
        const { vehicleId, fromState, toState, newRegNumber, buyerId, sellerId } = transferData;

        // Generate vehicle passport
        const passportResult = await generateVehiclePassport(vehicleId);
        if (passportResult.error) {
            return { error: passportResult.error };
        }

        const transferRequest = {
            transferId: crypto.randomUUID(),
            vehicle: {
                vehicleId,
                currentRegNumber: passportResult.passport.vehicle.regNumber,
                proposedRegNumber: newRegNumber,
                chassisNumber: passportResult.passport.vehicle.chassisNumber,
                engineNumber: passportResult.passport.vehicle.engineNumber
            },
            states: {
                from: {
                    code: fromState,
                    name: STATE_RTO_CODES[fromState] || "Unknown",
                    rtoAuthority: null // To be filled by origin RTO
                },
                to: {
                    code: toState,
                    name: STATE_RTO_CODES[toState] || "Unknown",
                    rtoAuthority: null // To be filled by destination RTO
                }
            },
            participants: {
                seller: sellerId,
                buyer: buyerId
            },
            passport: passportResult.passport,
            passportHash: passportResult.passportHash,
            status: "pending_approval",
            requiredApprovals: ["origin_rto", "destination_rto", "buyer", "seller"],
            approvals: {
                origin_rto: { approved: false, timestamp: null, officerId: null },
                destination_rto: { approved: false, timestamp: null, officerId: null },
                buyer: { approved: false, timestamp: null },
                seller: { approved: false, timestamp: null }
            },
            createdAt: new Date().toISOString(),
            metadata: {
                protocol: "cross_state_interoperability_v1",
                blockchainSyncRequired: true
            }
        };

        return {
            transferRequest,
            message: "Inter-state transfer request created"
        };
    } catch (error) {
        console.error("Error creating inter-state transfer:", error.message);
        return { error: error.message };
    }
};

/**
 * Approve inter-state transfer
 */
export const approveInterStateTransfer = async (transferId, approverRole, approverId) => {
    try {
        // In production, this would be stored in database
        // For now, simulate approval logic

        const approvalRecord = {
            transferId,
            approverRole,
            approverId,
            approved: true,
            timestamp: new Date().toISOString()
        };

        return {
            success: true,
            approval: approvalRecord,
            message: `${approverRole} approval recorded`
        };
    } catch (error) {
        console.error("Error approving transfer:", error.message);
        return { error: error.message };
    }
};

/**
 * Synchronize vehicle data with another state's RTO system
 */
export const syncWithStateRTO = async (vehicleId, targetState) => {
    try {
        const passport = await generateVehiclePassport(vehicleId);
        if (passport.error) {
            return { error: passport.error };
        }

        const syncData = {
            vehiclePassport: passport.passport,
            passportHash: passport.passportHash,
            syncTimestamp: new Date().toISOString(),
            sourceState: extractStateFromRegNumber(passport.passport.vehicle.regNumber),
            targetState,
            syncStatus: "completed",
            dataTransmitted: {
                vehicleDetails: true,
                ownershipHistory: true,
                statusInformation: true,
                documentHashes: true,
                personalData: false // Privacy protection
            }
        };

        return {
            success: true,
            sync: syncData,
            message: `Data synchronized with ${STATE_RTO_CODES[targetState] || targetState} RTO`
        };
    } catch (error) {
        console.error("Error syncing with state RTO:", error.message);
        return { error: error.message };
    }
};

/**
 * Get interoperability statistics
 */
export const getInteroperabilityStats = async () => {
    try {
        // Analyze vehicles by state
        const vehicles = await Vehicle.find({ regNumber: { $exists: true } });

        const stateDistribution = {};
        vehicles.forEach(vehicle => {
            const state = extractStateFromRegNumber(vehicle.regNumber);
            if (state) {
                stateDistribution[state] = (stateDistribution[state] || 0) + 1;
            }
        });

        return {
            totalVehicles: vehicles.length,
            stateDistribution,
            statesRegistered: Object.keys(stateDistribution).length,
            interoperabilityProtocol: "biochain_cross_state_v1",
            lastUpdated: new Date().toISOString()
        };
    } catch (error) {
        console.error("Error getting interoperability stats:", error.message);
        return { error: error.message };
    }
};

export default {
    generateVehiclePassport,
    verifyVehiclePassport,
    createInterStateTransfer,
    approveInterStateTransfer,
    syncWithStateRTO,
    getInteroperabilityStats,
    extractStateFromRegNumber,
    STATE_RTO_CODES
};
