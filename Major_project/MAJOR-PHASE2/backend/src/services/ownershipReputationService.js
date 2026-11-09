// ownershipReputationService.js
// PATENT FEATURE #8: Ownership Reputation Score System
// Assigns trust score to each vehicle owner based on their history

import { User } from "../models/User.js";
import { Vehicle } from "../models/Vehicle.js";
import { Request } from "../models/Request.js";
import { OwnershipHistory } from "../models/OwnershipHistory.js";
import { TheftReport } from "../models/TheftReport.js";

/**
 * Reputation scoring weights
 */
const REPUTATION_WEIGHTS = {
    TRANSACTION_COUNT: 15,
    VERIFICATION_SUCCESS: 20,
    FRAUD_CASES: -50,
    THEFT_REPORTS: -40,
    DOCUMENT_COMPLIANCE: 15,
    BIOMETRIC_VERIFICATION: 10,
    CHALLAN_PAYMENT: 10,
    ACCOUNT_AGE: 5,
    DID_VERIFIED: 10
};

/**
 * Calculate ownership reputation score for a user
 */
export const calculateReputationScore = async (userId) => {
    try {
        const user = await User.findById(userId);
        if (!user) {
            return { error: "User not found" };
        }

        const score = {
            userId: userId,
            timestamp: new Date().toISOString(),
            overallScore: 50, // Start with neutral score
            maxScore: 100,
            minScore: 0,
            grade: "C",
            breakdown: {},
            factors: [],
            recommendations: []
        };

        // Factor 1: Transaction history
        const transactionAnalysis = await analyzeTransactionHistory(userId);
        score.breakdown.transactionHistory = transactionAnalysis;
        score.factors.push(transactionAnalysis);

        // Factor 2: Verification success rate
        const verificationAnalysis = await analyzeVerificationSuccess(userId);
        score.breakdown.verificationSuccess = verificationAnalysis;
        score.factors.push(verificationAnalysis);

        // Factor 3: Fraud/theft cases
        const fraudAnalysis = await analyzeFraudCases(userId);
        score.breakdown.fraudCases = fraudAnalysis;
        score.factors.push(fraudAnalysis);

        // Factor 4: Document compliance
        const documentAnalysis = await analyzeDocumentCompliance(userId);
        score.breakdown.documentCompliance = documentAnalysis;
        score.factors.push(documentAnalysis);

        // Factor 5: Biometric verification
        const biometricAnalysis = analyzeBiometricVerification(user);
        score.breakdown.biometricVerification = biometricAnalysis;
        score.factors.push(biometricAnalysis);

        // Factor 6: Challan payment history
        const challanAnalysis = await analyzeChallanPayments(userId);
        score.breakdown.challanPayments = challanAnalysis;
        score.factors.push(challanAnalysis);

        // Factor 7: Account age
        const accountAgeAnalysis = analyzeAccountAge(user);
        score.breakdown.accountAge = accountAgeAnalysis;
        score.factors.push(accountAgeAnalysis);

        // Factor 8: DID verification
        const didAnalysis = analyzeDIDVerification(user);
        score.breakdown.didVerification = didAnalysis;
        score.factors.push(didAnalysis);

        // Calculate overall score
        score.overallScore = calculateOverallScore(score.breakdown);

        // Assign grade
        score.grade = assignGrade(score.overallScore);

        // Generate recommendations
        score.recommendations = generateRecommendations(score);

        return score;
    } catch (error) {
        console.error("Error calculating reputation score:", error.message);
        return {
            error: error.message,
            overallScore: 50,
            grade: "C"
        };
    }
};

/**
 * Analyze transaction history
 */
const analyzeTransactionHistory = async (userId) => {
    try {
        const totalTransactions = await OwnershipHistory.countDocuments({
            $or: [{ fromOwner: userId }, { toOwner: userId }]
        });

        const successfulTransactions = await Request.countDocuments({
            $or: [{ seller: userId }, { buyer: userId }],
            status: "approved"
        });

        let points = 0;
        if (totalTransactions >= 5) points = 15;
        else if (totalTransactions >= 3) points = 12;
        else if (totalTransactions >= 1) points = 8;

        return {
            category: "Transaction History",
            weight: REPUTATION_WEIGHTS.TRANSACTION_COUNT,
            points,
            data: {
                totalTransactions,
                successfulTransactions,
                successRate: totalTransactions > 0
                    ? Math.round((successfulTransactions / totalTransactions) * 100)
                    : 0
            }
        };
    } catch (error) {
        console.error("Error analyzing transactions:", error.message);
        return {
            category: "Transaction History",
            weight: REPUTATION_WEIGHTS.TRANSACTION_COUNT,
            points: 0,
            error: error.message
        };
    }
};

/**
 * Analyze verification success rate
 */
const analyzeVerificationSuccess = async (userId) => {
    try {
        const totalVerifications = await Request.countDocuments({
            $or: [{ seller: userId }, { buyer: userId }]
        });

        const successfulVerifications = await Request.countDocuments({
            $or: [{ seller: userId }, { buyer: userId }],
            status: "approved"
        });

        const successRate = totalVerifications > 0
            ? (successfulVerifications / totalVerifications) * 100
            : 100;

        let points = 0;
        if (successRate >= 95) points = 20;
        else if (successRate >= 80) points = 15;
        else if (successRate >= 60) points = 10;
        else points = 5;

        return {
            category: "Verification Success",
            weight: REPUTATION_WEIGHTS.VERIFICATION_SUCCESS,
            points,
            data: {
                totalVerifications,
                successfulVerifications,
                successRate: Math.round(successRate)
            }
        };
    } catch (error) {
        console.error("Error analyzing verifications:", error.message);
        return {
            category: "Verification Success",
            weight: REPUTATION_WEIGHTS.VERIFICATION_SUCCESS,
            points: 0,
            error: error.message
        };
    }
};

/**
 * Analyze fraud cases
 */
const analyzeFraudCases = async (userId) => {
    try {
        // Check for theft reports involving user's vehicles
        const userVehicles = await Vehicle.find({ currentOwner: userId });
        const vehicleIds = userVehicles.map(v => v._id);

        const theftReportsAgainst = await TheftReport.countDocuments({
            vehicle: { $in: vehicleIds },
            status: { $in: ["reported", "under_investigation"] }
        });

        let points = 0;
        if (theftReportsAgainst === 0) points = 0; // No penalty
        else if (theftReportsAgainst === 1) points = -40;
        else points = -80; // Multiple theft reports

        return {
            category: "Fraud Cases",
            weight: REPUTATION_WEIGHTS.FRAUD_CASES,
            points,
            data: {
                theftReports: theftReportsAgainst,
                isClean: theftReportsAgainst === 0
            }
        };
    } catch (error) {
        console.error("Error analyzing fraud cases:", error.message);
        return {
            category: "Fraud Cases",
            weight: REPUTATION_WEIGHTS.FRAUD_CASES,
            points: 0,
            error: error.message
        };
    }
};

/**
 * Analyze document compliance
 */
const analyzeDocumentCompliance = async (userId) => {
    try {
        const userVehicles = await Vehicle.find({ currentOwner: userId });

        let compliantVehicles = 0;
        let totalDocuments = 0;
        let verifiedDocuments = 0;

        for (const vehicle of userVehicles) {
            const hasRC = !!vehicle.ipfsDocuments?.rcCertificate;
            const hasInsurance = !!vehicle.ipfsDocuments?.insurance;

            if (hasRC && hasInsurance) {
                compliantVehicles++;
            }

            vehicle.documents?.forEach(doc => {
                totalDocuments++;
                if (doc.verificationStatus === "verified") {
                    verifiedDocuments++;
                }
            });
        }

        const complianceRate = userVehicles.length > 0
            ? (compliantVehicles / userVehicles.length) * 100
            : 100;

        let points = 0;
        if (complianceRate >= 90) points = 15;
        else if (complianceRate >= 70) points = 10;
        else if (complianceRate >= 50) points = 5;

        return {
            category: "Document Compliance",
            weight: REPUTATION_WEIGHTS.DOCUMENT_COMPLIANCE,
            points,
            data: {
                totalVehicles: userVehicles.length,
                compliantVehicles,
                complianceRate: Math.round(complianceRate),
                totalDocuments,
                verifiedDocuments
            }
        };
    } catch (error) {
        console.error("Error analyzing document compliance:", error.message);
        return {
            category: "Document Compliance",
            weight: REPUTATION_WEIGHTS.DOCUMENT_COMPLIANCE,
            points: 0,
            error: error.message
        };
    }
};

/**
 * Analyze biometric verification
 */
const analyzeBiometricVerification = (user) => {
    const hasBiometric = !!user.fingerprintTemplateId || !!user.biometricData?.fingerprint;
    const hasDID = !!user.did?.identifier;

    let points = 0;
    if (hasBiometric && hasDID) points = 10;
    else if (hasBiometric || hasDID) points = 5;

    return {
        category: "Biometric & DID Verification",
        weight: REPUTATION_WEIGHTS.BIOMETRIC_VERIFICATION,
        points,
        data: {
            biometricEnrolled: hasBiometric,
            didCreated: hasDID,
            fullyVerified: hasBiometric && hasDID
        }
    };
};

/**
 * Analyze challan payment history
 */
const analyzeChallanPayments = async (userId) => {
    try {
        // Import Challan model
        const Challan = (await import("../models/Challan.js")).Challan;

        const userVehicles = await Vehicle.find({ currentOwner: userId });
        const vehicleIds = userVehicles.map(v => v._id);

        const totalChallans = await Challan.countDocuments({
            vehicle: { $in: vehicleIds }
        });

        const paidChallans = await Challan.countDocuments({
            vehicle: { $in: vehicleIds },
            paymentStatus: "paid"
        });

        const pendingChallans = totalChallans - paidChallans;
        const paymentRate = totalChallans > 0
            ? (paidChallans / totalChallans) * 100
            : 100;

        let points = 0;
        if (pendingChallans === 0 && totalChallans === 0) points = 10; // No challans
        else if (paymentRate >= 90) points = 8;
        else if (paymentRate >= 70) points = 5;
        else points = 0; // Poor payment rate

        return {
            category: "Challan Payment History",
            weight: REPUTATION_WEIGHTS.CALLAN_PAYMENT,
            points,
            data: {
                totalChallans,
                paidChallans,
                pendingChallans,
                paymentRate: Math.round(paymentRate)
            }
        };
    } catch (error) {
        console.error("Error analyzing challan payments:", error.message);
        return {
            category: "Challan Payment History",
            weight: REPUTATION_WEIGHTS.CALLAN_PAYMENT,
            points: 0,
            error: error.message
        };
    }
};

/**
 * Analyze account age
 */
const analyzeAccountAge = (user) => {
    const accountAge = Date.now() - new Date(user.createdAt).getTime();
    const daysOld = Math.floor(accountAge / (1000 * 60 * 60 * 24));

    let points = 0;
    if (daysOld >= 365) points = 5;
    else if (daysOld >= 180) points = 3;
    else if (daysOld >= 30) points = 2;

    return {
        category: "Account Age",
        weight: REPUTATION_WEIGHTS.ACCOUNT_AGE,
        points,
        data: {
            daysSinceCreation: daysOld,
            accountAge: "established"
        }
    };
};

/**
 * Analyze DID verification
 */
const analyzeDIDVerification = (user) => {
    const hasDID = !!user.did?.identifier;
    const hasBlockchainWallet = !!user.blockchainWalletAddress;

    let points = 0;
    if (hasDID && hasBlockchainWallet) points = 10;
    else if (hasDID || hasBlockchainWallet) points = 5;

    return {
        category: "DID & Blockchain Verification",
        weight: REPUTATION_WEIGHTS.DID_VERIFIED,
        points,
        data: {
            didCreated: hasDID,
            blockchainWallet: hasBlockchainWallet,
            decentralized: hasDID && hasBlockchainWallet
        }
    };
};

/**
 * Calculate overall score from breakdown
 */
const calculateOverallScore = (breakdown) => {
    let totalPoints = 50; // Start with neutral score

    Object.values(breakdown).forEach(factor => {
        totalPoints += factor.points || 0;
    });

    // Clamp between 0 and 100
    return Math.max(0, Math.min(100, Math.round(totalPoints)));
};

/**
 * Assign grade based on score
 */
const assignGrade = (score) => {
    if (score >= 90) return "A+";
    if (score >= 80) return "A";
    if (score >= 70) return "B+";
    if (score >= 60) return "B";
    if (score >= 50) return "C";
    if (score >= 40) return "D";
    return "F";
};

/**
 * Generate recommendations based on score
 */
const generateRecommendations = (score) => {
    const recommendations = [];

    if (score.breakdown.transactionHistory?.points < 10) {
        recommendations.push("Complete more transactions to build history");
    }
    if (score.breakdown.verificationSuccess?.points < 15) {
        recommendations.push("Improve verification success rate");
    }
    if (score.breakdown.fraudCases?.points < 0) {
        recommendations.push("Resolve any pending fraud investigations");
    }
    if (score.breakdown.documentCompliance?.points < 10) {
        recommendations.push("Upload and verify all vehicle documents");
    }
    if (!score.breakdown.biometricVerification?.data?.fullyVerified) {
        recommendations.push("Complete biometric and DID verification");
    }
    if (score.breakdown.challanPayments?.data?.pendingChallans > 0) {
        recommendations.push(`Clear ${score.breakdown.challanPayments.data.pendingChallans} pending challans`);
    }

    if (recommendations.length === 0) {
        recommendations.push("Excellent reputation! Maintain your good standing.");
    }

    return recommendations;
};

/**
 * Get reputation score badge/color
 */
export const getReputationBadge = (score) => {
    if (score >= 90) return { badge: "", color: "gold", label: "Excellent" };
    if (score >= 70) return { badge: "", color: "green", label: "Good" };
    if (score >= 50) return { badge: "", color: "yellow", label: "Average" };
    if (score >= 30) return { badge: "", color: "orange", label: "Below Average" };
    return { badge: "", color: "red", label: "Poor" };
};

export default {
    calculateReputationScore,
    getReputationBadge
};
