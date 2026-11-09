// predictiveTheftDetection.js
// PATENT FEATURE #7: Predictive Theft Detection + Auto-Freezing
// Detects potential theft and automatically restricts vehicle operations

import { Vehicle } from "../models/Vehicle.js";
import { User } from "../models/User.js";
import { TheftReport } from "../models/TheftReport.js";
import { Request } from "../models/Request.js";
import { autoFreezeVehicle, reportVehicleStolen } from "./vehicleLifecycleService.js";
import { createNotification, createRoleNotification } from "./notificationService.js";

/**
 * Theft risk indicators and weights
 */
const THEFT_RISK_INDICATORS = {
    RAPID_OWNERSHIP_CHANGE: 30,
    LOCATION_MISMATCH: 25,
    UNUSUAL_TRANSFER_TIME: 15,
    NEW_OWNER_FLAGGED: 35,
    DOCUMENT_TAMPERING: 40,
    MULTIPLE_TRANSFER_ATTEMPTS: 20,
    BIOMETRIC_VERIFICATION_FAIL: 45,
    SUSPICIOUS_CHALLAN_PATTERN: 15
};

/**
 * Analyze vehicle for theft risk
 */
export const analyzeTheftRisk = async (vehicleId) => {
    try {
        const vehicle = await Vehicle.findById(vehicleId)
            .populate("currentOwner", "name email did blockchainWalletAddress")
            .populate("ownershipHistory.owner", "name email");

        if (!vehicle) {
            return { error: "Vehicle not found" };
        }

        const analysis = {
            vehicleId: vehicle._id.toString(),
            regNumber: vehicle.regNumber,
            timestamp: new Date().toISOString(),
            theftRiskScore: 0,
            riskLevel: "low",
            indicators: [],
            autoFreezeTriggered: false,
            recommendations: []
        };

        // Check 1: Rapid ownership changes (multiple transfers in short period)
        const rapidOwnershipChange = await detectRapidOwnershipChanges(vehicle);
        if (rapidOwnershipChange.detected) {
            analysis.theftRiskScore += THEFT_RISK_INDICATORS.RAPID_OWNERSHIP_CHANGE;
            analysis.indicators.push({
                type: "RAPID_OWNERSHIP_CHANGE",
                severity: "high",
                message: `${rapidOwnershipChange.count} ownership changes in last 30 days`,
                data: rapidOwnershipChange
            });
            analysis.recommendations.push("Investigate ownership transfer pattern");
        }

        // Check 2: Active theft report
        const activeTheftReport = await TheftReport.findOne({
            vehicle: vehicleId,
            status: { $in: ["reported", "under_investigation"] }
        });

        if (activeTheftReport) {
            analysis.theftRiskScore += 100; // Maximum risk
            analysis.indicators.push({
                type: "ACTIVE_THEFT_REPORT",
                severity: "critical",
                message: `Active theft report: FIR ${activeTheftReport.firNumber}`,
                data: {
                    firNumber: activeTheftReport.firNumber,
                    reportedDate: activeTheftReport.incidentDate,
                    policeStation: activeTheftReport.policeStation
                }
            });
            analysis.autoFreezeTriggered = true;
            analysis.recommendations.push("IMMEDIATE ACTION: Auto-freeze vehicle");
        }

        // Check 3: Unusual transfer patterns
        const unusualPattern = await detectUnusualTransferPatterns(vehicle);
        if (unusualPattern.detected) {
            analysis.theftRiskScore += THEFT_RISK_INDICATORS.UNUSUAL_TRANSFER_TIME;
            analysis.indicators.push({
                type: "UNUSUAL_TRANSFER_PATTERN",
                severity: "medium",
                message: unusualPattern.message,
                data: unusualPattern
            });
            analysis.recommendations.push("Require additional verification for transfer");
        }

        // Check 4: Recent failed biometric verifications
        const failedBiometrics = await checkFailedBiometrics(vehicle);
        if (failedBiometrics.count > 0) {
            analysis.theftRiskScore += THEFT_RISK_INDICATORS.BIOMETRIC_VERIFICATION_FAIL * failedBiometrics.count;
            analysis.indicators.push({
                type: "FAILED_BIOMETRIC_VERIFICATION",
                severity: "high",
                message: `${failedBiometrics.count} failed biometric attempts`,
                data: failedBiometrics
            });
            analysis.recommendations.push("Escalate for manual verification");
        }

        // Calculate risk level
        analysis.riskLevel = calculateTheftRiskLevel(analysis.theftRiskScore);

        // Auto-freeze if risk is critical
        if (analysis.theftRiskScore >= 70) {
            analysis.autoFreezeTriggered = true;
            analysis.recommendations.push("CRITICAL: Auto-freeze vehicle and notify authorities");
        }

        return analysis;
    } catch (error) {
        console.error("Error analyzing theft risk:", error.message);
        return {
            error: error.message,
            theftRiskScore: 100,
            riskLevel: "critical",
            autoFreezeTriggered: true
        };
    }
};

/**
 * Detect rapid ownership changes
 */
const detectRapidOwnershipChanges = async (vehicle) => {
    try {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const recentTransfers = vehicle.ownershipHistory?.filter(
            transfer => new Date(transfer.transferDate) >= thirtyDaysAgo
        ) || [];

        return {
            detected: recentTransfers.length >= 2,
            count: recentTransfers.length,
            transfers: recentTransfers
        };
    } catch (error) {
        console.error("Error detecting rapid changes:", error.message);
        return { detected: false, count: 0 };
    }
};

/**
 * Detect unusual transfer patterns
 */
const detectUnusualTransferPatterns = async (vehicle) => {
    try {
        // Check for transfers at unusual hours (2 AM - 5 AM)
        const recentTransfers = vehicle.ownershipHistory?.slice(-5) || [];

        const unusualTimeTransfers = recentTransfers.filter(transfer => {
            const hour = new Date(transfer.transferDate).getHours();
            return hour >= 2 && hour <= 5;
        });

        if (unusualTimeTransfers.length > 0) {
            return {
                detected: true,
                message: `${unusualTimeTransfers.length} transfers during unusual hours (2-5 AM)`,
                unusualTransfers: unusualTimeTransfers.length
            };
        }

        return { detected: false };
    } catch (error) {
        console.error("Error detecting unusual patterns:", error.message);
        return { detected: false };
    }
};

/**
 * Check failed biometric verifications
 */
const checkFailedBiometrics = async (vehicle) => {
    try {
        // In production, this would query biometric verification logs
        // For now, return mock data
        return {
            count: 0,
            attempts: []
        };
    } catch (error) {
        console.error("Error checking biometrics:", error.message);
        return { count: 0 };
    }
};

/**
 * Calculate theft risk level
 */
const calculateTheftRiskLevel = (score) => {
    if (score >= 70) return "critical";
    if (score >= 50) return "high";
    if (score >= 30) return "medium";
    return "low";
};

/**
 * Auto-freeze vehicle based on theft detection
 */
export const executeAutoFreeze = async (vehicleId, reason, authorizedBy = "system") => {
    try {
        const vehicle = await Vehicle.findById(vehicleId);
        if (!vehicle) {
            return { error: "Vehicle not found" };
        }

        // Check if already frozen or stolen
        if (vehicle.status === "stolen" || vehicle.status === "blocked") {
            return {
                success: false,
                message: `Vehicle is already in '${vehicle.status}' state`
            };
        }

        // Execute auto-freeze
        const freezeResult = await autoFreezeVehicle(vehicleId, reason, authorizedBy);

        // Notify relevant parties
        const notifications = await notifyAuthoritiesOfAutoFreeze(vehicle, reason);

        return {
            success: true,
            freezeResult,
            // Say how many people were actually told, not just that someone was
            notifiedSent: notifications.delivered,
            notificationSent: notifications.delivered > 0,
            timestamp: new Date().toISOString()
        };
    } catch (error) {
        console.error("Error executing auto-freeze:", error.message);
        return { error: error.message };
    }
};

/**
 * Notify authorities of auto-freeze
 * Writes real notifications into the bells of every police officer and RTO
 * officer plus the owner, and reports how many were delivered. A freeze that
 * nobody was told about is not a control.
 */
const notifyAuthoritiesOfAutoFreeze = async (vehicle, reason) => {
    try {
        const title = `Vehicle frozen by theft-risk engine: ${vehicle.regNumber}`;
        const message = `${vehicle.regNumber} (${vehicle.make} ${vehicle.model}) was frozen automatically. Reason: ${reason}. Transfers and document operations are blocked until an officer reviews it.`;

        const [police, rto] = await Promise.all([
            createRoleNotification({
                type: "auto-freeze", title, message, role: "police",
                relatedVehicle: vehicle._id, priority: "critical",
                actionRequired: true, actionUrl: "/police-dashboard"
            }),
            createRoleNotification({
                type: "auto-freeze", title, message, role: "rto",
                relatedVehicle: vehicle._id, priority: "critical"
            }),
        ]);

        let ownerNotified = 0;
        if (vehicle.currentOwner) {
            await createNotification({
                type: "auto-freeze",
                title: `Your vehicle ${vehicle.regNumber} was frozen`,
                message,
                recipient: vehicle.currentOwner,
                recipientRole: "owner",
                relatedVehicle: vehicle._id,
                priority: "critical",
                actionRequired: true
            });
            ownerNotified = 1;
        }

        const delivered = police.length + rto.length + ownerNotified;
        console.log(`Auto-freeze of ${vehicle.regNumber} notified ${delivered} recipient(s)`);
        return { success: delivered > 0, delivered };
    } catch (error) {
        console.error("Error notifying authorities:", error.message);
        return { success: false, delivered: 0, error: error.message };
    }
};

/**
 * Real-time theft monitoring dashboard
 */
export const getTheftMonitoringDashboard = async () => {
    try {
        // Get active theft reports
        const activeTheftReports = await TheftReport.find({
            status: { $in: ["reported", "under_investigation"] }
        })
            .populate("vehicle", "regNumber make model status")
            .populate("reporter", "name email");

        // Analyze high-risk vehicles
        const highRiskVehicles = [];
        const vehicles = await Vehicle.find({ status: "active" }).limit(50);

        for (const vehicle of vehicles) {
            const riskAnalysis = await analyzeTheftRisk(vehicle._id);
            if (riskAnalysis.theftRiskScore >= 50) {
                highRiskVehicles.push({
                    vehicle,
                    riskAnalysis
                });
            }
        }

        return {
            activeTheftReports: activeTheftReports.length,
            highRiskVehicles: highRiskVehicles,
            monitoringStatus: "active",
            lastUpdated: new Date().toISOString()
        };
    } catch (error) {
        console.error("Error getting theft dashboard:", error.message);
        return { error: error.message };
    }
};

/**
 * Handle theft report and trigger auto-freeze
 */
export const handleTheftReport = async (theftReportId) => {
    try {
        const theftReport = await TheftReport.findById(theftReportId).populate("vehicle");
        if (!theftReport) {
            return { error: "Theft report not found" };
        }

        // Auto-freeze vehicle
        const freezeResult = await executeAutoFreeze(
            theftReport.vehicle._id,
            `FIR ${theftReport.firNumber} - ${theftReport.description}`,
            "police_theft_report"
        );

        return {
            success: true,
            theftReport,
            autoFreeze: freezeResult,
            message: "Theft report processed - vehicle auto-frozen"
        };
    } catch (error) {
        console.error("Error handling theft report:", error.message);
        return { error: error.message };
    }
};

export default {
    analyzeTheftRisk,
    executeAutoFreeze,
    getTheftMonitoringDashboard,
    handleTheftReport
};
