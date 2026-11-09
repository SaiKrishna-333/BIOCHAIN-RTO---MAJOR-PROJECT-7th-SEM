import express from "express";
import { authRequired, requireRole } from "../middleware/authMiddleware.js";
import { Challan } from "../models/Challan.js";
import { Vehicle } from "../models/Vehicle.js";
import { User } from "../models/User.js";

const router = express.Router();

// ============================================
// OFFICER ROUTES (POLICE + RTO) - Create & Manage Challans
// ============================================

// Create new challan (Police or RTO officer)
router.post(
    "/create",
    authRequired,
    requireRole("police", "rto"),
    async (req, res) => {
        try {
            const {
                vehicleId,
                regNumber,
                violationType,
                violationDescription,
                location,
                violationDate,
                fineAmount,
                penaltyPoints,
                evidencePhotos,
                remarks
            } = req.body;

            // Validate required fields
            if (!regNumber) {
                return res.status(400).json({ message: "Vehicle registration number is required" });
            }

            if (!violationType || !violationDescription || !location) {
                return res.status(400).json({ message: "Violation details are required" });
            }

            if (!fineAmount || fineAmount <= 0) {
                return res.status(400).json({ message: "Fine amount must be greater than 0" });
            }

            // Verify vehicle exists - use regNumber by default, or vehicleId if valid
            let vehicle = null;

            // First try to find by registration number (most reliable)
            if (regNumber) {
                vehicle = await Vehicle.findOne({ regNumber });
            }

            // If not found and vehicleId is valid (non-empty 24-char hex string), try by ID
            if (!vehicle && vehicleId && vehicleId.length === 24 && /^[0-9a-fA-F]{24}$/.test(vehicleId)) {
                vehicle = await Vehicle.findById(vehicleId);
            }

            if (!vehicle) {
                return res.status(404).json({ message: `Vehicle with registration '${regNumber}' not found` });
            }

            // Get officer details
            const officer = await User.findById(req.user.id);
            if (!officer) {
                return res.status(404).json({ message: "Officer not found" });
            }

            const challan = new Challan({
                vehicle: vehicle._id,
                regNumber: vehicle.regNumber || regNumber,
                violationType,
                violationDescription,
                location,
                violationDate: violationDate ? new Date(violationDate) : new Date(),
                fineAmount,
                penaltyPoints: penaltyPoints || 0,
                issuingOfficer: req.user.id,
                officerName: officer.name,
                officerBadgeNumber: officer.badgeNumber || `POLICE-${officer._id.toString().substring(0, 6)}`,
                evidencePhotos: evidencePhotos || [],
                remarks,
                status: "active",
                paymentStatus: "pending"
            });

            await challan.save();

            res.status(201).json({
                message: "Challan created successfully",
                challanId: challan._id,
                challan
            });
        } catch (err) {
            console.error("Create challan error:", err);
            console.error("Error stack:", err.stack);
            res.status(500).json({
                message: "Server error while creating challan",
                error: err.message
            });
        }
    }
);

// Get all challans issued by the logged-in officer (police or RTO)
router.get(
    "/my-challans",
    authRequired,
    requireRole("police", "rto"),
    async (req, res) => {
        try {
            const challans = await Challan.find({ issuingOfficer: req.user.id })
                .populate("vehicle", "regNumber make model")
                .sort({ createdAt: -1 });

            res.json(challans);
        } catch (err) {
            console.error("Get my challans error:", err.message);
            res.status(500).json({ message: "Server error" });
        }
    }
);

// Update challan status (cancel/dispute) - issuing side (police or RTO)
router.put(
    "/:id/status",
    authRequired,
    requireRole("police", "rto"),
    async (req, res) => {
        try {
            const { id } = req.params;
            const { status, disputeReason } = req.body;

            const challan = await Challan.findById(id);
            if (!challan) {
                return res.status(404).json({ message: "Challan not found" });
            }

            if (status === "disputed") {
                challan.disputeReason = disputeReason;
                challan.disputeDate = new Date();
            }

            challan.status = status;
            await challan.save();

            res.json({ message: "Challan status updated", challan });
        } catch (err) {
            console.error("Update challan status error:", err.message);
            res.status(500).json({ message: "Server error" });
        }
    }
);

// ============================================
// OWNER ROUTES - View & Pay Challans
// ============================================

// Get all pending challans for current user's vehicles
router.get(
    "/pending",
    authRequired,
    requireRole("owner"),
    async (req, res) => {
        try {
            // Get all vehicles owned by user
            const userVehicles = await Vehicle.find({
                currentOwner: req.user.id
            }).select("_id regNumber");

            const vehicleIds = userVehicles.map(v => v._id);

            // Partly paid challans are still dues: the transfer gate in
            // requestRoutes counts "pending" and "partial", so the owner's own
            // list has to count the same thing or it would hide a liability that
            // blocks their sale.
            const pendingChallans = await Challan.find({
                vehicle: { $in: vehicleIds },
                paymentStatus: { $in: ["pending", "partial"] },
                status: "active"
            })
                .populate("vehicle", "regNumber make model")
                .populate("issuingOfficer", "name badgeNumber")
                .sort({ violationDate: -1 });

            // Calculate total pending amount
            const totalPending = pendingChallans.reduce((sum, c) => sum + (c.fineAmount - c.paidAmount), 0);

            res.json({
                challans: pendingChallans,
                totalPending,
                count: pendingChallans.length
            });
        } catch (err) {
            console.error("Get pending challans error:", err.message);
            res.status(500).json({ message: "Server error" });
        }
    }
);

// Get all challans (paid + pending) for current user's vehicles
router.get(
    "/all",
    authRequired,
    requireRole("owner"),
    async (req, res) => {
        try {
            const userVehicles = await Vehicle.find({
                currentOwner: req.user.id
            }).select("_id regNumber");

            const vehicleIds = userVehicles.map(v => v._id);

            const allChallans = await Challan.find({
                vehicle: { $in: vehicleIds }
            })
                .populate("vehicle", "regNumber make model")
                .populate("issuingOfficer", "name badgeNumber")
                .sort({ createdAt: -1 });

            res.json(allChallans);
        } catch (err) {
            console.error("Get all challans error:", err.message);
            res.status(500).json({ message: "Server error" });
        }
    }
);

// Mark challan as paid
router.put(
    "/:id/pay",
    authRequired,
    requireRole("owner"),
    async (req, res) => {
        try {
            const { id } = req.params;
            const { paymentMethod, paidAmount } = req.body;

            const challan = await Challan.findById(id);
            if (!challan) {
                return res.status(404).json({ message: "Challan not found" });
            }

            // Verify this challan belongs to user's vehicle
            const vehicle = await Vehicle.findById(challan.vehicle);
            if (!vehicle || String(vehicle.currentOwner) !== String(req.user.id)) {
                return res.status(403).json({ message: "Not authorized to pay this challan" });
            }

            const fine = Number(challan.fineAmount) || 0;
            const alreadyPaid = Number(challan.paidAmount) || 0;
            const outstanding = Math.max(fine - alreadyPaid, 0);

            // Nothing supplied means the whole outstanding balance, which is what
            // the "Pay Now" button on the challan list offers.
            const tendered =
                paidAmount === undefined || paidAmount === null || paidAmount === ""
                    ? outstanding
                    : Number(paidAmount);

            if (!Number.isFinite(tendered) || tendered <= 0) {
                return res.status(400).json({ message: "Enter a payment amount greater than zero" });
            }
            if (tendered > outstanding) {
                return res.status(400).json({
                    message: `This challan has \u20b9${outstanding} outstanding - that is the most that can be paid.`
                });
            }

            challan.paidAmount = alreadyPaid + tendered;
            // A part payment must not clear the liability. The status follows the
            // money, so the transfer gate keeps working after a partial payment.
            challan.paymentStatus = challan.paidAmount >= fine ? "paid" : "partial";
            challan.paymentDate = new Date();
            challan.paymentMethod = paymentMethod || "online";

            await challan.save();

            const remaining = Math.max(fine - challan.paidAmount, 0);
            res.json({
                message: remaining > 0
                    ? `\u20b9${tendered} received. \u20b9${remaining} is still outstanding on this challan, so the vehicle remains blocked for transfers.`
                    : "Challan cleared in full",
                challan
            });
        } catch (err) {
            console.error("Pay challan error:", err.message);
            res.status(500).json({ message: "Server error" });
        }
    }
);

// ============================================
// Check Pending Challans for a Vehicle
// ============================================

// Check pending challans for a vehicle. Any authenticated account may read the
// dues summary of a vehicle it can act on: the RTO reviews before approving a
// transfer, and the OWNER's sell pre-flight (OwnerDashboard.handleSubmit) calls
// this before opening the biometric prompt - gating it to "rto" made the
// owner-side listing block silently fall through to backend enforcement, which
// fires only after the biometric and leaves the sell modal open.
router.get(
    "/check/:vehicleId",
    authRequired,
    async (req, res) => {
        try {
            const { vehicleId } = req.params;

            const pendingChallans = await Challan.find({
                vehicle: vehicleId,
                paymentStatus: { $in: ["pending", "partial"] },
                status: "active"
            })
                .populate("issuingOfficer", "name badgeNumber")
                .sort({ violationDate: -1 });

            const totalPending = pendingChallans.reduce((sum, c) => sum + (c.fineAmount - c.paidAmount), 0);

            res.json({
                hasPendingChallans: pendingChallans.length > 0,
                count: pendingChallans.length,
                totalPending,
                challans: pendingChallans
            });
        } catch (err) {
            console.error("Check challans error:", err.message);
            res.status(500).json({ message: "Server error" });
        }
    }
);

// Get challan history for a vehicle
router.get(
    "/history/:vehicleId",
    authRequired,
    async (req, res) => {
        try {
            const { vehicleId } = req.params;

            const allChallans = await Challan.find({
                vehicle: vehicleId
            })
                .populate("issuingOfficer", "name badgeNumber")
                .sort({ violationDate: -1 });

            const paidCount = allChallans.filter(c => c.paymentStatus === "paid").length;
            // A challan is outstanding until its fine is fully collected. A
            // partially-paid one still blocks a transfer and still shows in the
            // owner list, so it must be counted here too - otherwise these totals
            // would understate what is owed and disagree with those lists.
            const isOutstanding = (c) => c.paymentStatus === "pending" || c.paymentStatus === "partial";
            const pendingCount = allChallans.filter(isOutstanding).length;
            const totalPaid = allChallans
                .filter(c => c.paymentStatus === "paid")
                .reduce((sum, c) => sum + c.paidAmount, 0);
            const totalPending = allChallans
                .filter(isOutstanding)
                .reduce((sum, c) => sum + (c.fineAmount - c.paidAmount), 0);

            res.json({
                total: allChallans.length,
                paidCount,
                pendingCount,
                totalPaid,
                totalPending,
                challans: allChallans
            });
        } catch (err) {
            console.error("Get challan history error:", err.message);
            res.status(500).json({ message: "Server error" });
        }
    }
);

export default router;
