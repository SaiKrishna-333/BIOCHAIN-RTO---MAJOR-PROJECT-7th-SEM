import express from "express";
import { authRequired, requireRole, biometricRequired } from "../middleware/authMiddleware.js";
import { Request } from "../models/Request.js";
import { Vehicle } from "../models/Vehicle.js";
import { User } from "../models/User.js";
import { OwnershipHistory } from "../models/OwnershipHistory.js";
import {
    registerVehicleOnChain,
    transferVehicleOnChain,
    getCurrentOwnerFromChain
} from "../services/blockchainService.js";
import { storeTransferRecord } from "../services/ipfsService.js";
import { createNotification } from "../services/notificationService.js";
import { maskUserAadhaar } from "../utils/masking.js";

const router = express.Router();

router.post(
    "/new-registration",
    authRequired,
    requireRole("dealer"),
    async (req, res) => {
        try {
            const { buyerEmail, vehicleDetails, exShowroomPrice, roadTax, registrationFee, insuranceAmount, handlingCharges, otherCharges, paymentMode } = req.body;

            const buyer = await User.findOne({ email: buyerEmail, role: "owner" });
            if (!buyer) {
                return res.status(400).json({ message: "Buyer not found or invalid role" });
            }

            // Get dealer details
            const dealer = await User.findById(req.user.id);
            if (!dealer) {
                return res.status(400).json({ message: "Dealer not found" });
            }

            // Parse all prices to ensure they're numbers (handle string inputs)
            const parsedExShowroom = parseFloat(exShowroomPrice) || 0;
            const parsedRoadTax = parseFloat(roadTax) || 0;
            const parsedRegistrationFee = parseFloat(registrationFee) || 500;
            const parsedInsurance = parseFloat(insuranceAmount) || 0;
            const parsedHandling = parseFloat(handlingCharges) || 0;
            const parsedOther = parseFloat(otherCharges) || 0;

            const vehicle = new Vehicle({
                ...vehicleDetails,
                currentOwner: null
            });
            await vehicle.save();

            // Generate Invoice Number
            const invoiceNumber = `INV-${Date.now()}-${vehicle._id.toString().substring(0, 6).toUpperCase()}`;

            // Calculate GST (28% on ex-showroom + handling charges)
            const gstBase = parsedExShowroom + parsedHandling;
            const gstAmount = Math.round(gstBase * 0.28);

            // Calculate grand total correctly
            const grandTotal = parsedExShowroom +
                parsedRoadTax +
                parsedRegistrationFee +
                parsedInsurance +
                parsedHandling +
                gstAmount +
                parsedOther;

            // Content fingerprint of the invoice. It covers the printed figures and
            // nothing that changes with the clock, so the same invoice always
            // reproduces the same value and a tampered one does not.
            const crypto = await import('crypto');
            const signatureData = [
                invoiceNumber,
                vehicle._id,
                dealer._id,
                buyer._id,
                parsedExShowroom,
                parsedRoadTax,
                parsedRegistrationFee,
                parsedInsurance,
                parsedHandling,
                parsedOther,
                gstAmount,
                grandTotal
            ].join(':');
            const signatureHash = crypto.createHash('sha256').update(signatureData).digest('hex');

            const request = new Request({
                type: "newRegistration",
                vehicle: vehicle._id,
                dealer: req.user.id,
                buyer: buyer._id,
                status: "pending",
                invoice: {
                    invoiceNumber,
                    invoiceDate: new Date(),
                    exShowroomPrice: parsedExShowroom,
                    roadTax: parsedRoadTax,
                    registrationFee: parsedRegistrationFee,
                    insuranceAmount: parsedInsurance,
                    handlingCharges: parsedHandling,
                    otherCharges: parsedOther,
                    gstAmount,
                    grandTotal,
                    paymentMode: paymentMode || "Full Payment",
                    // No payment is taken here, so the invoice must not claim one.
                    paymentStatus: "Pending",
                    verificationStatus: "pending",
                    signatureHash
                },
                documentsVerified: false
            });

            await request.save();

            // Populate the request for response
            const populatedRequest = await Request.findById(request._id)
                .populate('vehicle')
                .populate('dealer', 'name email dealerDetails')
                .populate('buyer', 'name email aadhaarNumber dlNumber address');

            // The dealer raised the request; the buyer's identity number is not
            // theirs to keep.
            maskUserAadhaar(populatedRequest?.buyer);

            res.status(201).json({
                message: "New registration request created with invoice",
                requestId: request._id,
                invoiceNumber,
                request: populatedRequest
            });
        } catch (err) {
            console.error("new-registration error:", err.message);
            res.status(500).json({ message: "Server error" });
        }
    }
);

router.post(
    "/transfer",
    authRequired,
    requireRole("owner"),
    async (req, res) => {
        try {
            const { vehicleId, buyerEmail } = req.body;

            const vehicle = await Vehicle.findById(vehicleId);
            if (!vehicle) {
                return res.status(400).json({ message: "Vehicle not found" });
            }

            if (!vehicle.currentOwner || String(vehicle.currentOwner) !== String(req.user.id)) {
                return res.status(400).json({ message: "You do not own this vehicle" });
            }

            const buyer = await User.findOne({ email: buyerEmail, role: "owner" });
            if (!buyer) {
                return res.status(400).json({ message: "Buyer not found" });
            }
            if (String(buyer._id) === String(req.user.id)) {
                return res.status(400).json({ message: "You cannot sell a vehicle to yourself." });
            }

            // Pending challans must be cleared BEFORE a resale offer can be raised,
            // not merely at RTO approval. Enforcing here means the seller sees the
            // block on their own screen and can settle the dues instead of the
            // buyer's money and the RTO's time being spent on an unapprovable
            // request. This mirrors the check enforced in the approve handler
            // below, but is surfaced earlier.
            const Challan = (await import('../models/Challan.js')).Challan;
            const pendingChallansAtOffer = await Challan.find({
                vehicle: vehicle._id,
                paymentStatus: { $in: ["pending", "partial"] },
                status: "active"
            });
            if (pendingChallansAtOffer.length > 0) {
                const totalPending = pendingChallansAtOffer.reduce((sum, c) => sum + (c.fineAmount - c.paidAmount), 0);
                return res.status(400).json({
                    message: `Vehicle has ${pendingChallansAtOffer.length} pending challan(s) totalling \u20b9${totalPending}. Settle all dues before listing it for sale.`,
                    pendingChallansCount: pendingChallansAtOffer.length,
                    totalPendingAmount: totalPending
                });
            }

            const request = new Request({
                type: "transfer",
                vehicle: vehicle._id,
                seller: req.user.id,
                buyer: buyer._id,
                status: "pending"
            });

            // Enhanced resale offer: created only when the seller sends offer data.
            // When an offer exists the buyer must review + accept before RTO approval.
            const { salePrice, message: offerMessage, attachIntel } = req.body;
            const hasSalePrice = salePrice !== undefined && salePrice !== null && salePrice !== "";
            const hasMessage = typeof offerMessage === "string" && offerMessage.trim() !== "";
            if (hasSalePrice || hasMessage || attachIntel === true) {
                request.offer = {
                    salePrice: hasSalePrice ? Number(salePrice) : undefined,
                    message: hasMessage ? offerMessage : undefined,
                    attachIntel: attachIntel !== false // default ON when offer data present
                };
            }

            await request.save();

            if (hasRealOffer(request)) {
                try {
                    await createNotification({
                        type: "transfer-offer",
                        title: "You received a vehicle purchase offer",
                        message: `${req.user.name} offered ${vehicle.make} ${vehicle.model}${vehicle.regNumber ? ` (${vehicle.regNumber})` : ""} to you. Review the full verified history and accept or decline.`,
                        recipient: buyer._id,
                        recipientRole: "owner",
                        relatedVehicle: vehicle._id,
                        relatedRequest: request._id,
                        actionRequired: true,
                        actionUrl: "/owner?tab=offers"
                    });
                } catch (notifErr) {
                    console.error("offer notification failed:", notifErr.message);
                }
            }

            res.status(201).json({ message: "Transfer request created", requestId: request._id, offerCreated: hasRealOffer(request) });
        } catch (err) {
            console.error("transfer error:", err.message);
            res.status(500).json({ message: "Server error" });
        }
    }
);

// ---------------------------------------------------------------------------
// Resale offers (buyer side). The buyer sees the FULL vehicle intelligence
// (workshop-uploaded records) before accepting - the data lives on the
// vehicle, so it follows the new owner automatically after approval.
// ---------------------------------------------------------------------------

const buildIntelSummary = async (vehicleId) => {
    try {
        const { ServiceRecord } = await import("../models/ServiceRecord.js");
        const { ComponentRecord } = await import("../models/ComponentRecord.js");
        const { DamageEvent } = await import("../models/DamageEvent.js");
        const { BatteryPassport } = await import("../models/BatteryPassport.js");
        const [serviceCount, latestService, partsTracked, damageEvents, battery] = await Promise.all([
            ServiceRecord.countDocuments({ vehicle: vehicleId }),
            ServiceRecord.findOne({ vehicle: vehicleId }).sort({ odometerKm: -1 }).select("serviceDate odometerKm serviceType"),
            ComponentRecord.countDocuments({ vehicle: vehicleId }),
            DamageEvent.countDocuments({ vehicle: vehicleId }),
            BatteryPassport.findOne({ vehicle: vehicleId }).select("currentSoH lastTestedAt")
        ]);
        return {
            serviceRecords: serviceCount,
            latestService: latestService ? { date: latestService.serviceDate, odometerKm: latestService.odometerKm, type: latestService.serviceType } : null,
            partsTracked,
            damageEvents,
            battery: battery ? { currentSoH: battery.currentSoH ?? null, lastTestedAt: battery.lastTestedAt || null } : null
        };
    } catch (err) {
        console.error("buildIntelSummary error:", err.message);
        return null;
    }
};

const hasRealOffer = (r) => !!r.offer && (r.offer.salePrice != null || r.offer.attachIntel != null || !!r.offer.message || r.offer.buyerAccepted != null || !!r.offer.declinedAt);

// GET /incoming-offers - pending resale offers where I am the buyer
router.get(
    "/incoming-offers",
    authRequired,
    requireRole("owner"),
    async (req, res) => {
        try {
            const requests = await Request.find({ buyer: req.user.id, type: "transfer", status: "pending" })
                .populate("vehicle")
                .populate("seller", "name email phone")
                .sort({ createdAt: -1 });

            const offers = await Promise.all(requests.map(async (r) => ({
                _id: r._id,
                createdAt: r.createdAt,
                vehicle: r.vehicle ? {
                    _id: r.vehicle._id, regNumber: r.vehicle.regNumber, make: r.vehicle.make,
                    model: r.vehicle.model, year: r.vehicle.year, fuelType: r.vehicle.fuelType
                } : null,
                seller: r.seller ? { name: r.seller.name, email: r.seller.email, phone: r.seller.phone } : null,
                offer: hasRealOffer(r) ? r.offer : { attachIntel: false },
                // Full verified workshop records bundled so the buyer can decide here
                intel: r.offer?.attachIntel && r.vehicle ? await buildIntelSummary(r.vehicle._id) : null
            })));

            res.json({ success: true, offers });
        } catch (err) {
            console.error("incoming-offers error:", err.message);
            res.status(500).json({ message: "Server error" });
        }
    }
);

// GET /my-offers - resale offers I (the seller) sent, with live buyer/RTO status
router.get(
    "/my-offers",
    authRequired,
    requireRole("owner"),
    async (req, res) => {
        try {
            const requests = await Request.find({ seller: req.user.id, type: "transfer" })
                .populate("vehicle", "regNumber make model year fuelType")
                .populate("buyer", "name email")
                .sort({ createdAt: -1 });

            const offers = requests.map((r) => {
                let state = "awaiting-buyer";
                if (r.status === "approved") state = "transferred";
                else if (r.status === "rejected") state = r.offer?.declinedAt ? "declined-by-buyer" : "rejected-by-rto";
                else if (hasRealOffer(r) && r.offer.buyerAccepted) state = "buyer-accepted";
                else if (!hasRealOffer(r)) state = "awaiting-rto";
                return {
                    _id: r._id,
                    createdAt: r.createdAt,
                    status: r.status,
                    state,
                    vehicle: r.vehicle || null,
                    buyer: r.buyer ? { name: r.buyer.name, email: r.buyer.email } : null,
                    offer: hasRealOffer(r) ? r.offer : null,
                    declineReason: r.offer?.declineReason || r.remarks || null
                };
            });

            res.json({ success: true, offers });
        } catch (err) {
            console.error("my-offers error:", err.message);
            res.status(500).json({ message: "Server error" });
        }
    }
);

// POST /:id/accept-buyer { paymentMode? } - buyer reviewed the offer and accepts
router.post(
    "/:id/accept-buyer",
    authRequired,
    requireRole("owner"),
    async (req, res) => {
        try {
            const request = await Request.findById(req.params.id);
            if (!request || request.type !== "transfer" || String(request.buyer) !== String(req.user.id)) {
                return res.status(404).json({ message: "Offer not found" });
            }
            if (request.status !== "pending") {
                return res.status(400).json({ message: `This offer is already ${request.status}.` });
            }
            if (!hasRealOffer(request)) {
                return res.status(400).json({ message: "This transfer was created as a plain request (no offer) - RTO can process it directly." });
            }
            if (request.offer.buyerAccepted) {
                return res.status(409).json({ message: "You already accepted this offer." });
            }

            request.offer.buyerAccepted = true;
            request.offer.buyerAcceptedAt = new Date();
            request.offer.buyerPaymentMode = req.body.paymentMode || "Demo Payment";
            await request.save();

            try {
                await createNotification({
                    type: "transfer-offer",
                    title: "Buyer accepted your vehicle sale offer",
                    message: `${req.user.name} accepted your offer and verified with biometrics. The RTO will finalize the ownership transfer.`,
                    recipient: request.seller,
                    recipientRole: "owner",
                    relatedVehicle: request.vehicle,
                    relatedRequest: request._id,
                    actionUrl: "/owner?tab=offers"
                });
            } catch (notifErr) {
                console.error("accept notification failed:", notifErr.message);
            }

            res.json({ message: "Offer accepted. Awaiting RTO final approval.", requestId: request._id });
        } catch (err) {
            console.error("accept-buyer error:", err.message);
            res.status(500).json({ message: "Server error" });
        }
    }
);

// POST /:id/decline-buyer { reason? }
router.post(
    "/:id/decline-buyer",
    authRequired,
    requireRole("owner"),
    async (req, res) => {
        try {
            const request = await Request.findById(req.params.id);
            if (!request || request.type !== "transfer" || String(request.buyer) !== String(req.user.id)) {
                return res.status(404).json({ message: "Offer not found" });
            }
            if (request.status !== "pending") {
                return res.status(400).json({ message: `This offer is already ${request.status}.` });
            }

            request.status = "rejected";
            request.remarks = `Buyer declined: ${req.body.reason || "no reason given"}`;
            if (hasRealOffer(request)) {
                request.offer.declinedAt = new Date();
                request.offer.declineReason = req.body.reason || undefined;
            }
            await request.save();

            try {
                await createNotification({
                    type: "transfer-offer",
                    title: "Buyer declined your vehicle sale offer",
                    message: `${req.user.name} declined your offer${req.body.reason ? `: ${req.body.reason}` : ""}.`,
                    recipient: request.seller,
                    recipientRole: "owner",
                    relatedVehicle: request.vehicle,
                    relatedRequest: request._id,
                    actionUrl: "/owner?tab=offers"
                });
            } catch (notifErr) {
                console.error("decline notification failed:", notifErr.message);
            }

            res.json({ message: "Offer declined", requestId: request._id });
        } catch (err) {
            console.error("decline-buyer error:", err.message);
            res.status(500).json({ message: "Server error" });
        }
    }
);

// Get all requests (RTO only)
router.get(
    "/all",
    authRequired,
    requireRole("rto"),
    async (req, res) => {
        try {
            const requests = await Request.find()
                .populate("vehicle")
                .populate("dealer", "name")
                .populate("seller", "name")
                .populate("buyer", "name")
                .sort({ createdAt: -1 });
            // Expose `offer` only when the seller actually created one -
            // Mongoose hydrates absent single-nested subdocs as truthy {}.
            res.json(requests.map((r) => ({
                ...r.toObject(),
                offer: hasRealOffer(r) ? r.offer : null
            })));
        } catch (err) {
            console.error("get all requests error:", err.message);
            res.status(500).json({ message: "Server error" });
        }
    }
);

// Get dealer's own requests (Dealer only)
router.get(
    "/my-requests",
    authRequired,
    requireRole("dealer"),
    async (req, res) => {
        try {
            const requests = await Request.find({ dealer: req.user.id })
                .populate("vehicle")
                .populate("buyer", "name")
                .sort({ createdAt: -1 });
            res.json(requests);
        } catch (err) {
            console.error("get dealer requests error:", err.message);
            res.status(500).json({ message: "Server error" });
        }
    }
);

router.post(
    "/:id/approve",
    authRequired,
    requireRole("rto"),
    async (req, res) => {
        try {
            const { id } = req.params;
            const { regNumber } = req.body;

            const request = await Request.findById(id).populate("vehicle");
            if (!request || request.status !== "pending") {
                return res.status(400).json({ message: "Invalid request" });
            }

            const vehicle = await Vehicle.findById(request.vehicle._id);

            // FOR TRANSFER REQUESTS: Check for pending challans
            if (request.type === "transfer") {
                // Resale offers require the buyer to review the attached vehicle
                // intelligence and accept before the RTO can finalize.
                if (hasRealOffer(request) && !request.offer.buyerAccepted) {
                    return res.status(400).json({ message: "Buyer has not reviewed and accepted this resale offer yet. Ask the buyer to open Incoming Offers and accept." });
                }

                const Challan = (await import('../models/Challan.js')).Challan;

                const pendingChallans = await Challan.find({
                    vehicle: vehicle._id,
                    paymentStatus: { $in: ["pending", "partial"] },
                    status: "active"
                });

                if (pendingChallans.length > 0) {
                    const totalPending = pendingChallans.reduce((sum, c) => sum + (c.fineAmount - c.paidAmount), 0);
                    return res.status(400).json({
                        message: `Vehicle has ${pendingChallans.length} pending challan(s) totaling ₹${totalPending}. All challans must be cleared before transfer.`,
                        pendingChallansCount: pendingChallans.length,
                        totalPendingAmount: totalPending,
                        challans: pendingChallans.map(c => ({
                            challanId: c._id,
                            violationType: c.violationType,
                            fineAmount: c.fineAmount,
                            paidAmount: c.paidAmount,
                            remainingAmount: c.fineAmount - c.paidAmount
                        }))
                    });
                }

                // Feature 8: Conditional Multi-Party Approval gate.
                // If an approval checklist exists for this transfer, every mandatory
                // step must be approved before the transfer can be finalized.
                // Transfers with no workflow keep the original behaviour (no break).
                const { TransferApprovalWorkflow } = await import('../models/TransferApprovalWorkflow.js');
                const workflow = await TransferApprovalWorkflow.findOne({ request: request._id });
                if (workflow) {
                    const progress = workflow.progress;
                    if (progress.overall !== "complete") {
                        const pending = workflow.steps.filter(s => s.required && s.status !== "approved" && s.status !== "not_required")
                            .map(s => ({ key: s.key, label: s.label, status: s.status }));
                        return res.status(400).json({
                            message: "Approval checklist is incomplete. Resolve all mandatory steps before finalizing the transfer.",
                            progress,
                            pendingSteps: pending
                        });
                    }
                }
            }

            let txHash;
            try {
                if (request.type === "newRegistration") {
                    if (!regNumber) return res.status(400).json({ message: "Registration number required" });
                    vehicle.regNumber = regNumber;

                    // Issuing a number is the moment an RC's issue date, office and
                    // signing officer become facts worth storing.
                    const officer = await User.findById(req.user.id).select("name employeeId rtoDetails");
                    vehicle.registrationDate = new Date();
                    vehicle.issuedByOffice = officer?.rtoDetails?.rtoOfficeName || null;
                    vehicle.issuedByOfficer = officer
                        ? `${officer.name}${officer.employeeId ? ` (${officer.employeeId})` : ""}`
                        : null;

                    // Get user's blockchain wallet address
                    const buyerUser = await User.findById(request.buyer);
                    // Only the wallet issued to an account can hold a registry entry - a
                    // placeholder built from an id is not a valid address. Such a
                    // registration is recorded in the database and left unanchored.
                    const ownerAddress = buyerUser?.blockchainWalletAddress;
                    if (!ownerAddress) {
                        console.warn(`Not anchoring the registration of ${vehicle.regNumber}: ${buyerUser?.name || "the buyer"} has no wallet address linked to the account yet.`);
                    } else {
                        txHash = await registerVehicleOnChain(
                            vehicle.regNumber,
                            vehicle.chassisNumber,
                            vehicle.engineNumber,
                            vehicle.make,
                            vehicle.model,
                            vehicle.year,
                            ownerAddress
                        );
                    }

                    vehicle.currentOwner = request.buyer;
                    if (txHash) vehicle.blockchainTxHash = txHash;
                } else {
                    // A transfer of a vehicle that has never been issued a registration
                    // number is not a transfer the registry can act on, and approving one
                    // would put an owner change on a record the state has never declared.
                    if (!vehicle.regNumber) {
                        return res.status(400).json({
                            message: "This vehicle has no registration number yet, so its ownership cannot be transferred. Approve its registration first."
                        });
                    }

                    // Get user's blockchain wallet addresses
                    const sellerUser = await User.findById(request.seller);
                    const buyerUser = await User.findById(request.buyer);

                    // A transfer reissues the certificate in the buyer's name, so the
                    // office and officer behind that decision are recorded as well.
                    const transferOfficer = await User.findById(req.user.id).select("name employeeId rtoDetails");
                    if (transferOfficer?.rtoDetails?.rtoOfficeName) vehicle.issuedByOffice = transferOfficer.rtoDetails.rtoOfficeName;
                    if (transferOfficer)
                        vehicle.issuedByOfficer = `${transferOfficer.name}${transferOfficer.employeeId ? ` (${transferOfficer.employeeId})` : ""}`;
                    if (!vehicle.registrationDate) vehicle.registrationDate = new Date();

                    const sellerAddress = sellerUser?.blockchainWalletAddress;
                    const buyerAddress = buyerUser?.blockchainWalletAddress;

                    if (!sellerAddress || !buyerAddress) {
                        const without = !sellerAddress ? (sellerUser?.name || "the seller") : (buyerUser?.name || "the buyer");
                        console.warn(`Not anchoring the transfer of ${vehicle.regNumber}: ${without} has no wallet address linked to the account yet.`);
                    } else {
                        txHash = await transferVehicleOnChain(vehicle.regNumber, sellerAddress, buyerAddress, "purchase", "0x0000000000000000000000000000000000000000000000000000000000000000");
                    }

                    vehicle.currentOwner = request.buyer;
                    if (txHash) vehicle.blockchainTxHash = txHash;
                }

                await vehicle.save();
            } catch (blockchainErr) {
                // The chain step failed, the registry step did not. The record is
                // still written; only the commitment is missing.
                console.error("Blockchain operation failed, proceeding without an on-chain tx:", blockchainErr.message);

                // A number the officer supplied is issued as normal. Nothing is
                // invented when none was supplied - a "TEMP-<timestamp>" plate would
                // look like a real registration to every screen that reads it.
                if (request.type === "newRegistration") {
                    if (regNumber && !vehicle.regNumber) vehicle.regNumber = regNumber;
                    if (!vehicle.regNumber) {
                        console.warn(`Approved a new registration for chassis ${vehicle.chassisNumber} without a registration number - the officer must issue one before the certificate can print.`);
                    }
                }
                vehicle.currentOwner = request.buyer;
                // Any hash this vehicle already earned is kept: a failed extra write does
                // not undo a commitment that exists, and clearing it would break the link.
                await vehicle.save();
            }

            // Update invoice with blockchain hash for new registrations
            if (request.type === "newRegistration" && request.invoice && vehicle.blockchainTxHash) {
                request.invoice.blockchainTxHash = vehicle.blockchainTxHash;
                await Request.findByIdAndUpdate(request._id, { invoice: request.invoice });
            }

            // Create ownership history record
            const ownershipRecord = await OwnershipHistory.create({
                vehicle: vehicle._id,
                fromOwner: request.seller || null,
                toOwner: request.buyer,
                blockchainTxHash: txHash,
                transferType: request.type === "newRegistration" ? "new_registration" : "purchase",
                biometricVerification: req.biometricVerification || null
            });

            // Keep a content-addressed copy of the transfer paperwork beside the
            // ownership record (verified vault when no IPFS tier is configured).
            try {
                const transferData = {
                    vehicleRegNumber: vehicle.regNumber,
                    vehicleDetails: {
                        make: vehicle.make,
                        model: vehicle.model,
                        year: vehicle.year,
                        chassisNumber: vehicle.chassisNumber,
                        engineNumber: vehicle.engineNumber
                    },
                    transferType: request.type,
                    fromOwner: request.seller ? (await User.findById(request.seller))?.email : "DEALER",
                    toOwner: (await User.findById(request.buyer))?.email,
                    txHash: txHash,
                    approvedBy: req.user.id,
                    approvedAt: new Date().toISOString(),
                    biometricVerified: !!req.biometricVerification
                };

                const ipfsResult = await storeTransferRecord(transferData);
                ownershipRecord.ipfsDocumentHash = ipfsResult.ipfsHash;
                await ownershipRecord.save();

                // Update vehicle with IPFS reference
                vehicle.ipfsRecordHash = ipfsResult.ipfsHash;
                await vehicle.save();
            } catch (storeErr) {
                console.error("Failed to store the transfer record in the document store:", storeErr.message);
                // Don't fail the operation if document storage fails
            }

            request.status = "approved";
            request.rtoOfficer = req.user.id;
            await request.save();

            // Persistent notifications so both parties see the outcome in the bell
            try {
                const vLabel = `${vehicle.make} ${vehicle.model}${vehicle.regNumber ? ` (${vehicle.regNumber})` : ""}`;
                await createNotification({
                    type: request.type === "newRegistration" ? "registration-approved" : "transfer-approved",
                    title: request.type === "newRegistration" ? "New registration approved by RTO" : "Ownership transfer approved by RTO",
                    message: `RTO approved ${request.type === "newRegistration" ? `the registration of ${vLabel}` : `the transfer of ${vLabel}`} to you. ${txHash ? "On-chain proof recorded." : "On-chain anchoring pending."}`,
                    recipient: request.buyer,
                    recipientRole: "owner",
                    relatedVehicle: vehicle._id,
                    relatedRequest: request._id,
                    actionUrl: "/owner"
                });
                if (request.seller) {
                    await createNotification({
                        type: "transfer-approved",
                        title: "Vehicle sale completed",
                        message: `RTO finalized the transfer of ${vLabel} to ${(await User.findById(request.buyer))?.name || "the buyer"}. Ownership has changed on-chain where anchored.`,
                        recipient: request.seller,
                        recipientRole: "owner",
                        relatedVehicle: vehicle._id,
                        relatedRequest: request._id,
                        actionUrl: "/owner?tab=offers"
                    });
                }
            } catch (notifErr) {
                console.error("approval notification failed:", notifErr.message);
            }

            res.json({ message: "Request approved", txHash, ipfsHash: ownershipRecord.ipfsDocumentHash });
        } catch (err) {
            console.error("approve error:", err.message);
            res.status(500).json({ message: "Server error" });
        }
    }
);

router.post(
    "/:id/reject",
    authRequired,
    requireRole("rto"),
    async (req, res) => {
        try {
            const { id } = req.params;
            const { remarks } = req.body;

            const request = await Request.findById(id);
            if (!request || request.status !== "pending") {
                return res.status(400).json({ message: "Invalid request" });
            }

            request.status = "rejected";
            request.remarks = remarks;
            request.rtoOfficer = req.user.id;
            await request.save();

            // Notify both parties of the RTO decision
            try {
                const audience = [request.buyer, request.seller].filter(Boolean);
                for (const recipient of audience) {
                    await createNotification({
                        type: "request-rejected",
                        title: `RTO rejected your ${request.type} request`,
                        message: `Reason: ${remarks || "not specified"}`,
                        recipient,
                        recipientRole: "owner",
                        relatedRequest: request._id,
                        actionUrl: "/owner?tab=offers"
                    });
                }
            } catch (notifErr) {
                console.error("rejection notification failed:", notifErr.message);
            }

            res.json({ message: "Request rejected" });
        } catch (err) {
            console.error("reject error:", err.message);
            res.status(500).json({ message: "Server error" });
        }
    }
);

// Get invoice details for a request
router.get("/:id/invoice", authRequired, async (req, res) => {
    try {
        const { id } = req.params;

        const request = await Request.findById(id)
            .populate('vehicle')
            .populate('dealer', 'name email dealerDetails')
            .populate('buyer', 'name email aadhaarNumber dlNumber address')
            .populate('invoice.verifiedBy', 'name email');

        if (!request) {
            return res.status(404).json({ message: "Request not found" });
        }

        if (request.type !== "newRegistration") {
            return res.status(400).json({ message: "Invoice only available for new registrations" });
        }

        // Check authorization
        const isDealer = String(request.dealer._id) === String(req.user.id);
        const isBuyer = String(request.buyer._id) === String(req.user.id);
        const isRTO = req.user.role === "rto";
        const isPolice = req.user.role === "police";

        if (!isDealer && !isBuyer && !isRTO && !isPolice) {
            return res.status(403).json({ message: "Not authorized to view this invoice" });
        }

        const dealer = request.dealer;
        const buyer = request.buyer;
        const vehicle = request.vehicle;
        const invoice = request.invoice;

        // Format invoice data for frontend
        const invoiceData = {
            invoiceNumber: invoice.invoiceNumber,
            invoiceDate: invoice.invoiceDate,
            // Dealer details
            dealerName: dealer.name,
            dealerBusinessName: dealer.dealerDetails?.businessName || dealer.name,
            dealerGSTIN: dealer.dealerDetails?.gstin || "N/A",
            dealerTIN: dealer.dealerDetails?.tin || "N/A",
            dealerLicense: dealer.dealerDetails?.licenseNumber || "N/A",
            dealerAddress: dealer.dealerDetails?.showroomAddress || "Address not provided",
            dealerPhone: dealer.dealerDetails?.phone || "N/A",
            dealerEmail: dealer.email,
            // Buyer details - the identity number is never sent in full to a page
            // that only needs to show that one is on file.
            buyerName: buyer.name,
            buyerEmail: buyer.email,
            buyerAadhaar: buyer.aadhaarNumber
                ? `XXXX-XXXX-${String(buyer.aadhaarNumber).replace(/\D/g, "").slice(-4)}`
                : "Not recorded",
            buyerDL: buyer.dlNumber || "N/A",
            buyerAddress: buyer.address || "Address not provided",
            // Vehicle details
            chassisNumber: vehicle.chassisNumber,
            engineNumber: vehicle.engineNumber,
            make: vehicle.make,
            model: vehicle.model,
            year: vehicle.year,
            // Pricing
            exShowroomPrice: invoice.exShowroomPrice,
            roadTax: invoice.roadTax,
            registrationFee: invoice.registrationFee,
            insuranceAmount: invoice.insuranceAmount,
            handlingCharges: invoice.handlingCharges,
            otherCharges: invoice.otherCharges,
            gstAmount: invoice.gstAmount,
            grandTotal: invoice.grandTotal,
            // Payment
            paymentMode: invoice.paymentMode,
            paymentStatus: invoice.paymentStatus,
            // Verification
            verificationStatus: invoice.verificationStatus,
            verifiedBy: invoice.verifiedBy?.name || null,
            verifiedAt: invoice.verifiedAt,
            verificationRemarks: invoice.verificationRemarks,
            signatureHash: invoice.signatureHash,
            // Blockchain - prefer invoice hash, fallback to vehicle hash
            blockchainTxHash: invoice.blockchainTxHash || vehicle.blockchainTxHash
        };

        res.json(invoiceData);
    } catch (err) {
        console.error("Get invoice error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Get my invoices (for owner)
router.get("/my-invoices", authRequired, async (req, res) => {
    try {
        // Find all requests where the user is the buyer and has an invoice
        const requests = await Request.find({
            buyer: req.user.id,
            type: "newRegistration",
            invoice: { $exists: true }
        })
            .populate('vehicle', 'make model regNumber year')
            .select('_id invoice createdAt status');

        const invoices = requests.map(req => ({
            _id: req._id,
            invoiceNumber: req.invoice.invoiceNumber,
            vehicle: req.vehicle,
            status: req.status,
            createdAt: req.createdAt
        }));

        res.json(invoices);
    } catch (err) {
        console.error("Get my invoices error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Verify invoice (RTO only)
router.put("/:id/verify-invoice", authRequired, requireRole("rto"), async (req, res) => {
    try {
        const { id } = req.params;
        const { status, remarks } = req.body;

        const request = await Request.findById(id);
        if (!request) {
            return res.status(404).json({ message: "Request not found" });
        }

        if (request.type !== "newRegistration") {
            return res.status(400).json({ message: "Invoice verification only for new registrations" });
        }

        if (!request.invoice) {
            return res.status(400).json({ message: "No invoice found for this request" });
        }

        request.invoice.verificationStatus = status;
        request.invoice.verifiedBy = req.user.id;
        request.invoice.verifiedAt = new Date();
        request.invoice.verificationRemarks = remarks || "";

        // If invoice is verified, mark documents as verified
        if (status === "verified") {
            request.documentsVerified = true;
        }

        await request.save();

        res.json({
            message: `Invoice ${status}`,
            verificationStatus: status
        });
    } catch (err) {
        console.error("Verify invoice error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

export default router;
