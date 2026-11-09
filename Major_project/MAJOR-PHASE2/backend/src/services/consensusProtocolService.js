// consensusProtocolService.js
// PATENT FEATURE #3: Multi-Authority Consensus Protocol
// Ensures vehicle transfer happens only when multiple authorities approve

import { Vehicle } from "../models/Vehicle.js";
import { User } from "../models/User.js";
import { Request } from "../models/Request.js";

/**
 * Create multi-authority consensus request
 * Requires approvals from seller, buyer, and RTO officer
 */
export const createConsensusRequest = async (transactionData) => {
    try {
        const { vehicleId, sellerId, buyerId, type, details } = transactionData;

        // Validate participants
        const seller = await User.findById(sellerId);
        const buyer = await User.findById(buyerId);
        const vehicle = await Vehicle.findById(vehicleId);

        if (!seller || !buyer || !vehicle) {
            return { error: "Invalid participants or vehicle" };
        }

        // Create consensus request
        const consensusRequest = {
            vehicle: vehicleId,
            seller: sellerId,
            buyer: buyerId,
            type,
            status: "pending",
            requiredApprovals: ["seller", "buyer", "rto"],
            approvals: {
                seller: {
                    approved: false,
                    timestamp: null,
                    signature: null,
                    biometricHash: null
                },
                buyer: {
                    approved: false,
                    timestamp: null,
                    signature: null,
                    biometricHash: null
                },
                rto: {
                    approved: false,
                    officerId: null,
                    timestamp: null,
                    signature: null,
                    remarks: null
                }
            },
            policeVerification: {
                required: false,
                completed: false,
                officerId: null,
                timestamp: null,
                clearanceNumber: null
            },
            createdAt: new Date().toISOString(),
            details: details || {},
            metadata: {
                consensusProtocol: "multi_authority_v1",
                securityLevel: "enhanced"
            }
        };

        return consensusRequest;
    } catch (error) {
        console.error("Error creating consensus request:", error.message);
        return { error: error.message };
    }
};

/**
 * Record approval from an authority
 */
export const recordApproval = async (consensusRequestId, authority, approvalData) => {
    try {
        // For now, we'll store in Request model with extended structure
        const request = await Request.findById(consensusRequestId);
        if (!request) {
            return { error: "Consensus request not found" };
        }

        if (authority === "seller") {
            if (!request.consensus) {
                request.consensus = await createConsensusRequest({
                    vehicleId: request.vehicle,
                    sellerId: request.seller || request.dealer,
                    buyerId: request.buyer,
                    type: request.type
                });
            }

            request.consensus.approvals.seller = {
                approved: true,
                timestamp: new Date().toISOString(),
                signature: approvalData.signature,
                biometricHash: approvalData.biometricHash,
                ipAddress: approvalData.ipAddress
            };
        } else if (authority === "buyer") {
            request.consensus.approvals.buyer = {
                approved: true,
                timestamp: new Date().toISOString(),
                signature: approvalData.signature,
                biometricHash: approvalData.biometricHash,
                ipAddress: approvalData.ipAddress
            };
        } else if (authority === "rto") {
            request.consensus.approvals.rto = {
                approved: true,
                officerId: approvalData.officerId,
                timestamp: new Date().toISOString(),
                signature: approvalData.signature,
                remarks: approvalData.remarks
            };
        } else if (authority === "police") {
            request.consensus.policeVerification = {
                required: true,
                completed: true,
                officerId: approvalData.officerId,
                timestamp: new Date().toISOString(),
                clearanceNumber: approvalData.clearanceNumber
            };
        }

        // Check if consensus is complete
        const consensusComplete = checkConsensusComplete(request.consensus);

        if (consensusComplete) {
            request.consensus.status = "consensus_reached";
            request.consensus.consensusReachedAt = new Date().toISOString();
        }

        await request.save();

        return {
            success: true,
            consensusStatus: request.consensus.status,
            consensusComplete,
            approvals: request.consensus.approvals
        };
    } catch (error) {
        console.error("Error recording approval:", error.message);
        return { error: error.message };
    }
};

/**
 * Check if all required approvals are collected
 */
const checkConsensusComplete = (consensus) => {
    if (!consensus) return false;

    const sellerApproved = consensus.approvals.seller.approved;
    const buyerApproved = consensus.approvals.buyer.approved;
    const rtoApproved = consensus.approvals.rto.approved;

    // Police verification required for high-value or suspicious transfers
    const policeVerified = !consensus.policeVerification.required || consensus.policeVerification.completed;

    return sellerApproved && buyerApproved && rtoApproved && policeVerified;
};

/**
 * Get consensus status for a transaction
 */
export const getConsensusStatus = async (requestId) => {
    try {
        const request = await Request.findById(requestId).populate({
            path: "vehicle",
            populate: { path: "currentOwner", select: "name email" }
        }).populate("seller", "name email").populate("buyer", "name email");

        if (!request) {
            return { error: "Request not found" };
        }

        if (!request.consensus) {
            return {
                status: "not_initialized",
                message: "Consensus protocol not initialized for this request"
            };
        }

        return {
            requestId,
            vehicle: request.vehicle,
            seller: request.seller,
            buyer: request.buyer,
            consensus: request.consensus,
            status: request.consensus.status,
            pendingApprovals: getPendingApprovals(request.consensus)
        };
    } catch (error) {
        console.error("Error getting consensus status:", error.message);
        return { error: error.message };
    }
};

/**
 * Get list of pending approvals
 */
const getPendingApprovals = (consensus) => {
    const pending = [];

    if (!consensus.approvals.seller.approved) {
        pending.push("seller");
    }
    if (!consensus.approvals.buyer.approved) {
        pending.push("buyer");
    }
    if (!consensus.approvals.rto.approved) {
        pending.push("rto");
    }
    if (consensus.policeVerification.required && !consensus.policeVerification.completed) {
        pending.push("police");
    }

    return pending;
};

/**
 * Get consensus statistics for dashboard
 */
export const getConsensusStatistics = async () => {
    try {
        const requests = await Request.find({ consensus: { $exists: true } });

        const stats = {
            totalConsensusRequests: requests.length,
            pending: requests.filter(r => r.consensus?.status === "pending").length,
            consensusReached: requests.filter(r => r.consensus?.status === "consensus_reached").length,
            rejected: requests.filter(r => r.consensus?.status === "rejected").length,
            averageApprovalTime: null,
            pendingPoliceVerification: requests.filter(r => r.consensus?.policeVerification?.required && !r.consensus?.policeVerification?.completed).length
        };

        // Calculate average approval time for completed requests
        const completedRequests = requests.filter(r => r.consensus?.status === "consensus_reached");
        if (completedRequests.length > 0) {
            const totalTime = completedRequests.reduce((sum, r) => {
                const created = new Date(r.createdAt);
                const consensus = new Date(r.consensus.consensusReachedAt);
                return sum + (consensus - created);
            }, 0);
            stats.averageApprovalTime = Math.round(totalTime / completedRequests.length / 1000 / 60); // in minutes
        }

        return stats;
    } catch (error) {
        console.error("Error getting consensus statistics:", error.message);
        return { error: error.message };
    }
};

export default {
    createConsensusRequest,
    recordApproval,
    getConsensusStatus,
    getConsensusStatistics
};
