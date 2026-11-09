// fraudDetectionService.js
// PATENT FEATURE #2: AI-Based Fraud Detection Engine
// Continuously monitors vehicle transactions to detect suspicious behavior

import { Vehicle } from "../models/Vehicle.js";
import { User } from "../models/User.js";
import { Request } from "../models/Request.js";
import { TheftReport } from "../models/TheftReport.js";
import { OwnershipHistory } from "../models/OwnershipHistory.js";

/**
 * Risk scoring weights
 */
const RISK_WEIGHTS = {
    TRANSFER_FREQUENCY: 25,
    SAME_ID_MULTI_ACCOUNT: 30,
    RAPID_RESALE: 20,
    THEFT_FLAG: 50,
    SUSPICIOUS_LOCATION: 15,
    DOCUMENT_MISMATCH: 35,
    VEHICLE_STATE_VIOLATION: 40,
    CHALLAN_PENDING: 20,
    BIOMETRIC_MISMATCH: 45
};

/**
 * Analyze user behavior patterns for fraud detection
 * @param {string} userId - User ID to analyze
 * @returns {Object} - Fraud analysis result
 */
export const analyzeUserBehavior = async (userId) => {
    try {
        const user = await User.findById(userId);
        if (!user) {
            return { error: "User not found" };
        }

        const analysis = {
            userId,
            timestamp: new Date().toISOString(),
            riskScore: 0,
            riskLevel: "low",
            indicators: [],
            recommendations: []
        };

        // Check 1: Frequent ownership transfers
        const recentTransfers = await countRecentTransfers(userId, 90); // Last 90 days
        if (recentTransfers >= 3) {
            analysis.riskScore += RISK_WEIGHTS.TRANSFER_FREQUENCY;
            analysis.indicators.push({
                type: "FREQUENT_TRANSFERS",
                severity: "high",
                message: `User has ${recentTransfers} ownership transfers in last 90 days`,
                data: { transferCount: recentTransfers }
            });
            analysis.recommendations.push("Require additional verification for transfer requests");
        }

        // Check 2: Multiple accounts with same identity
        const duplicateAccounts = await findDuplicateIdentityAccounts(user);
        if (duplicateAccounts > 0) {
            analysis.riskScore += RISK_WEIGHTS.SAME_ID_MULTI_ACCOUNT;
            analysis.indicators.push({
                type: "DUPLICATE_ACCOUNTS",
                severity: "critical",
                message: `Found ${duplicateAccounts} accounts with same identity markers`,
                data: { duplicateCount: duplicateAccounts }
            });
            analysis.recommendations.push("Block all transactions pending identity verification");
        }

        // Check 3: Rapid resale attempts
        const hasRapidResale = await detectRapidResale(userId);
        if (hasRapidResale) {
            analysis.riskScore += RISK_WEIGHTS.RAPID_RESALE;
            analysis.indicators.push({
                type: "RAPID_RESALE",
                severity: "high",
                message: "Detected rapid resale pattern within 30 days of acquisition",
                data: { pattern: "rapid_resale" }
            });
            analysis.recommendations.push("Require RTO officer approval for all transfers");
        }

        // Calculate risk level
        analysis.riskLevel = calculateRiskLevel(analysis.riskScore);

        return analysis;
    } catch (error) {
        console.error("Error analyzing user behavior:", error.message);
        return { error: error.message, riskScore: 100, riskLevel: "critical" };
    }
};

/**
 * Count recent ownership transfers for a user
 */
const countRecentTransfers = async (userId, days) => {
    try {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days);

        const transfers = await OwnershipHistory.countDocuments({
            $or: [{ fromOwner: userId }, { toOwner: userId }],
            createdAt: { $gte: cutoffDate }
        });

        return transfers;
    } catch (error) {
        console.error("Error counting transfers:", error.message);
        return 0;
    }
};

/**
 * Find duplicate accounts using same identity markers
 */
const findDuplicateIdentityAccounts = async (user) => {
    try {
        if (!user.aadhaarNumber) return 0;

        const duplicates = await User.countDocuments({
            _id: { $ne: user._id },
            $or: [
                { aadhaarNumber: user.aadhaarNumber },
                { email: user.email }
            ]
        });

        return duplicates;
    } catch (error) {
        console.error("Error finding duplicates:", error.message);
        return 0;
    }
};

/**
 * Detect rapid resale pattern
 */
const detectRapidResale = async (userId) => {
    try {
        // Find vehicles user owned recently
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const recentOwnership = await OwnershipHistory.find({
            toOwner: userId,
            createdAt: { $gte: thirtyDaysAgo }
        }).populate("vehicle");

        // Check if any were transferred out quickly (within 7 days)
        for (const ownership of recentOwnership) {
            const transferHistory = await OwnershipHistory.findOne({
                vehicle: ownership.vehicle._id,
                fromOwner: userId,
                createdAt: { $gte: ownership.createdAt }
            });

            if (transferHistory) {
                const daysOwned = Math.floor(
                    (transferHistory.createdAt - ownership.createdAt) / (1000 * 60 * 60 * 24)
                );

                if (daysOwned <= 7) {
                    return true;
                }
            }
        }

        return false;
    } catch (error) {
        console.error("Error detecting rapid resale:", error.message);
        return false;
    }
};

/**
 * Analyze transaction for fraud risk
 * @param {Object} transaction - Transaction data
 * @returns {Object} - Transaction fraud analysis
 */
export const analyzeTransaction = async (transaction) => {
    try {
        const analysis = {
            transactionId: transaction._id || transaction.id,
            timestamp: new Date().toISOString(),
            riskScore: 0,
            riskLevel: "low",
            checks: [],
            shouldBlock: false,
            blockReason: null
        };

        const { vehicleId, sellerId, buyerId, type } = transaction;

        // Get vehicle details
        const vehicle = await Vehicle.findById(vehicleId);
        if (!vehicle) {
            return { error: "Vehicle not found" };
        }

        // Check 1: Vehicle state violations
        if (vehicle.status === "stolen") {
            analysis.riskScore += RISK_WEIGHTS.VEHICLE_STATE_VIOLATION;
            analysis.checks.push({
                name: "VEHICLE_STATE",
                status: "failed",
                message: "Vehicle is reported as stolen",
                severity: "critical"
            });
            analysis.shouldBlock = true;
            analysis.blockReason = "Vehicle is stolen - transfer blocked";
        } else if (vehicle.status === "blocked") {
            analysis.riskScore += RISK_WEIGHTS.VEHICLE_STATE_VIOLATION;
            analysis.checks.push({
                name: "VEHICLE_STATE",
                status: "failed",
                message: "Vehicle is blocked",
                severity: "critical"
            });
            analysis.shouldBlock = true;
            analysis.blockReason = "Vehicle is blocked";
        }

        // Check 2: Active theft report
        const activeTheftReport = await TheftReport.findOne({
            vehicle: vehicleId,
            status: { $in: ["reported", "under_investigation"] }
        });

        if (activeTheftReport) {
            analysis.riskScore += RISK_WEIGHTS.THEFT_FLAG;
            analysis.checks.push({
                name: "THEFT_CHECK",
                status: "failed",
                message: `Active theft report: FIR ${activeTheftReport.firNumber}`,
                severity: "critical"
            });
            analysis.shouldBlock = true;
            analysis.blockReason = `Theft report ${activeTheftReport.firNumber} active`;
        }

        // Check 3: Seller behavior analysis
        const sellerAnalysis = await analyzeUserBehavior(sellerId);
        analysis.riskScore += sellerAnalysis.riskScore;
        if (sellerAnalysis.riskScore > 30) {
            analysis.checks.push({
                name: "SELLER_BEHAVIOR",
                status: "warning",
                message: `Seller risk score: ${sellerAnalysis.riskScore}`,
                severity: sellerAnalysis.riskScore > 50 ? "high" : "medium",
                details: sellerAnalysis.indicators
            });
        }

        // Check 4: Buyer behavior analysis
        const buyerAnalysis = await analyzeUserBehavior(buyerId);
        analysis.riskScore += buyerAnalysis.riskScore;
        if (buyerAnalysis.riskScore > 30) {
            analysis.checks.push({
                name: "BUYER_BEHAVIOR",
                status: "warning",
                message: `Buyer risk score: ${buyerAnalysis.riskScore}`,
                severity: buyerAnalysis.riskScore > 50 ? "high" : "medium",
                details: buyerAnalysis.indicators
            });
        }

        // Calculate final risk level
        analysis.riskLevel = calculateRiskLevel(analysis.riskScore);

        // Block if critical
        if (analysis.riskScore >= 70) {
            analysis.shouldBlock = true;
            analysis.blockReason = "Transaction risk score exceeds threshold";
        }

        return analysis;
    } catch (error) {
        console.error("Error analyzing transaction:", error.message);
        return {
            error: error.message,
            riskScore: 100,
            riskLevel: "critical",
            shouldBlock: true,
            blockReason: "System error - blocked for safety"
        };
    }
};

/**
 * Calculate risk level from score
 */
const calculateRiskLevel = (score) => {
    if (score >= 70) return "critical";
    if (score >= 50) return "high";
    if (score >= 30) return "medium";
    return "low";
};

/**
 * Get real-time fraud dashboard data
 */
export const getFraudDashboardData = async () => {
    try {
        // Get recent high-risk transactions
        const recentTransactions = await Request.find({
            createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
            status: "pending"
        })
            .populate("vehicle")
            .populate("seller", "name email")
            .populate("buyer", "name email")
            .limit(20);

        const analyzedTransactions = await Promise.all(
            recentTransactions.map(async (tx) => {
                // Guard: populated refs can be null (deleted vehicle, dealer
                // registrations have no buyer) - reading ._id on null crashed the dashboard
                const analysis = await analyzeTransaction({
                    vehicleId: tx.vehicle?._id,
                    sellerId: tx.seller?._id || tx.dealer?._id,
                    buyerId: tx.buyer?._id,
                    type: tx.type
                });
                return {
                    transactionId: tx._id,
                    type: tx.type,
                    vehicle: tx.vehicle,
                    seller: tx.seller || tx.dealer,
                    buyer: tx.buyer,
                    riskAnalysis: analysis
                };
            })
        );

        // Get fraud statistics
        const stats = {
            totalTransactionsAnalyzed: await Request.countDocuments(),
            highRiskTransactions: analyzedTransactions.filter(t => t.riskAnalysis.riskLevel === "high" || t.riskAnalysis.riskLevel === "critical").length,
            blockedTransactions: analyzedTransactions.filter(t => t.riskAnalysis.shouldBlock).length,
            averageRiskScore: analyzedTransactions.length > 0
                ? Math.round(analyzedTransactions.reduce((sum, t) => sum + t.riskAnalysis.riskScore, 0) / analyzedTransactions.length)
                : 0
        };

        return {
            stats,
            recentTransactions: analyzedTransactions,
            generatedAt: new Date().toISOString()
        };
    } catch (error) {
        console.error("Error getting fraud dashboard data:", error.message);
        return { error: error.message };
    }
};

export default {
    analyzeUserBehavior,
    analyzeTransaction,
    getFraudDashboardData
};
