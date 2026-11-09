// patentFeaturesRoutes.js
// API Routes for all 8 Patent-Level Features

import express from "express";
import { authRequired, requireRole } from "../middleware/authMiddleware.js";

// Import all patent feature services
import * as enhancedBiometricDID from "../services/enhancedBiometricDIDService.js";
import * as fraudDetection from "../services/fraudDetectionService.js";
import * as consensusProtocol from "../services/consensusProtocolService.js";
import * as vehicleLifecycle from "../services/vehicleLifecycleService.js";
import * as privacyVerification from "../services/privacyPreservingVerification.js";
import * as crossStateInteroperability from "../services/crossStateInteroperability.js";
import * as predictiveTheft from "../services/predictiveTheftDetection.js";
import * as ownershipReputation from "../services/ownershipReputationService.js";

const router = express.Router();

// ==========================================
// FEATURE 1: Biometric + DID Binding Protocol
// ==========================================

// Generate biometric hash
router.post("/biometric/hash", authRequired, async (req, res) => {
    try {
        const { biometricTemplate } = req.body;
        const biometricHash = enhancedBiometricDID.generateBiometricHash(biometricTemplate);
        res.json({ success: true, biometricHash });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create biometric-bound DID
router.post("/biometric-did/create", authRequired, async (req, res) => {
    try {
        const { biometricTemplate } = req.body;
        const result = await enhancedBiometricDID.createBiometricBoundDID(
            req.user.id,
            req.user.role,
            biometricTemplate
        );
        res.json({ success: true, ...result });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Verify biometric against DID
router.post("/biometric-did/verify", authRequired, async (req, res) => {
    try {
        const { biometricTemplate, didDocument } = req.body;
        const result = enhancedBiometricDID.verifyBiometricAgainstDID(biometricTemplate, didDocument);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// FEATURE 2: AI-Based Fraud Detection Engine
// ==========================================

// Analyze user behavior for fraud
router.get("/fraud/analyze-user/:userId", authRequired, requireRole("rto", "police"), async (req, res) => {
    try {
        const result = await fraudDetection.analyzeUserBehavior(req.params.userId);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Analyze transaction for fraud
router.post("/fraud/analyze-transaction", authRequired, async (req, res) => {
    try {
        const result = await fraudDetection.analyzeTransaction(req.body);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get fraud dashboard data
router.get("/fraud/dashboard", authRequired, requireRole("rto", "police"), async (req, res) => {
    try {
        const result = await fraudDetection.getFraudDashboardData();
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// FEATURE 3: Multi-Authority Consensus Protocol
// ==========================================

// Create consensus request
router.post("/consensus/create", authRequired, async (req, res) => {
    try {
        const result = await consensusProtocol.createConsensusRequest(req.body);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Record approval
router.post("/consensus/:id/approve", authRequired, async (req, res) => {
    try {
        const { authority, ...approvalData } = req.body;
        const result = await consensusProtocol.recordApproval(req.params.id, authority, approvalData);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get consensus status
router.get("/consensus/:id/status", authRequired, async (req, res) => {
    try {
        const result = await consensusProtocol.getConsensusStatus(req.params.id);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get consensus statistics
router.get("/consensus/statistics", authRequired, requireRole("rto"), async (req, res) => {
    try {
        const result = await consensusProtocol.getConsensusStatistics();
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// FEATURE 4: Vehicle Lifecycle State Machine
// ==========================================

// Get vehicle state info
router.get("/lifecycle/:vehicleId/state", authRequired, async (req, res) => {
    try {
        const result = await vehicleLifecycle.getVehicleStateInfo(req.params.vehicleId);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Transition vehicle state
router.post("/lifecycle/:vehicleId/transition", authRequired, requireRole("rto", "police"), async (req, res) => {
    try {
        const { newState, reason } = req.body;
        const result = await vehicleLifecycle.transitionVehicleState(req.params.vehicleId, newState, {
            reason,
            authorizedBy: req.user.id
        });
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Check if vehicle can be transferred
router.get("/lifecycle/:vehicleId/can-transfer", authRequired, async (req, res) => {
    try {
        const result = await vehicleLifecycle.canTransferVehicle(req.params.vehicleId);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Auto-freeze vehicle
router.post("/lifecycle/:vehicleId/freeze", authRequired, requireRole("police"), async (req, res) => {
    try {
        const { reason } = req.body;
        const result = await vehicleLifecycle.autoFreezeVehicle(req.params.vehicleId, reason, req.user.id);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// FEATURE 5: Privacy-Preserving Ownership Verification
// ==========================================

// Verify ownership (privacy-preserving)
router.get("/privacy/verify/:vehicleId", authRequired, async (req, res) => {
    try {
        const result = await privacyVerification.verifyOwnershipPrivacyPreserving(
            req.params.vehicleId,
            req.user.role
        );
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Verify ownership by reg number
router.get("/privacy/verify-by-reg/:regNumber", authRequired, async (req, res) => {
    try {
        const result = await privacyVerification.verifyOwnershipByRegNumber(
            req.params.regNumber,
            req.user.role
        );
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Generate zero-knowledge proof
router.post("/privacy/zkp/generate/:vehicleId", authRequired, async (req, res) => {
    try {
        const { ownerDID } = req.body;
        const result = await privacyVerification.generateOwnershipZKP(req.params.vehicleId, ownerDID);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Verify zero-knowledge proof
router.post("/privacy/zkp/verify", authRequired, async (req, res) => {
    try {
        const { proof, regNumber } = req.body;
        const result = await privacyVerification.verifyOwnershipZKP(proof, regNumber);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Bulk verify ownership
router.post("/privacy/bulk-verify", authRequired, requireRole("rto", "police"), async (req, res) => {
    try {
        const { vehicleIds } = req.body;
        const result = await privacyVerification.bulkVerifyOwnership(vehicleIds, req.user.role);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// FEATURE 6: Cross-State RTO Interoperability
// ==========================================

// Generate vehicle passport
router.get("/interoperability/passport/:vehicleId", authRequired, async (req, res) => {
    try {
        const result = await crossStateInteroperability.generateVehiclePassport(req.params.vehicleId);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Verify vehicle passport
router.post("/interoperability/passport/verify", authRequired, async (req, res) => {
    try {
        const { passport, passportHash } = req.body;
        const result = await crossStateInteroperability.verifyVehiclePassport(passport, passportHash);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create inter-state transfer
router.post("/interoperability/transfer", authRequired, async (req, res) => {
    try {
        const result = await crossStateInteroperability.createInterStateTransfer(req.body);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Approve inter-state transfer
router.post("/interoperability/transfer/:id/approve", authRequired, requireRole("rto"), async (req, res) => {
    try {
        const { approverRole } = req.body;
        const result = await crossStateInteroperability.approveInterStateTransfer(
            req.params.id,
            approverRole,
            req.user.id
        );
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Sync with state RTO
router.post("/interoperability/sync/:vehicleId", authRequired, requireRole("rto"), async (req, res) => {
    try {
        const { targetState } = req.body;
        const result = await crossStateInteroperability.syncWithStateRTO(req.params.vehicleId, targetState);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get interoperability stats
router.get("/interoperability/stats", authRequired, async (req, res) => {
    try {
        const result = await crossStateInteroperability.getInteroperabilityStats();
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// FEATURE 7: Predictive Theft Detection + Auto-Freezing
// ==========================================

// Analyze theft risk
router.get("/theft/risk/:vehicleId", authRequired, async (req, res) => {
    try {
        const result = await predictiveTheft.analyzeTheftRisk(req.params.vehicleId);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Execute auto-freeze
router.post("/theft/auto-freeze/:vehicleId", authRequired, requireRole("police"), async (req, res) => {
    try {
        const { reason } = req.body;
        const result = await predictiveTheft.executeAutoFreeze(req.params.vehicleId, reason, req.user.id);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get theft monitoring dashboard
router.get("/theft/dashboard", authRequired, requireRole("police"), async (req, res) => {
    try {
        const result = await predictiveTheft.getTheftMonitoringDashboard();
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Handle theft report
router.post("/theft/report/:reportId", authRequired, requireRole("police"), async (req, res) => {
    try {
        const result = await predictiveTheft.handleTheftReport(req.params.reportId);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// FEATURE 8: Ownership Reputation Score System
// ==========================================

// Calculate reputation score
router.get("/reputation/:userId", authRequired, async (req, res) => {
    try {
        const result = await ownershipReputation.calculateReputationScore(req.params.userId);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get reputation badge
router.get("/reputation/badge/:score", authRequired, async (req, res) => {
    try {
        const badge = ownershipReputation.getReputationBadge(parseInt(req.params.score));
        res.json({ success: true, badge });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

export default router;
