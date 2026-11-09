// idCardRoutes.js
// Issues and serves the citizen's Digital Identity Card (mParivahan style).
// Every issued card is tamper-evident: the card content is hashed with SHA-256
// and that hash is recorded on the card. The system then tries to commit the
// hash on Polygon Amoy, exactly like every other record here; when the
// anchoring wallet cannot pay the fee the card stays honestly pending and says
// so, instead of claiming a transaction that does not exist.

import express from "express";
import crypto from "crypto";
import { User } from "../models/User.js";
import { UserIdCard } from "../models/UserIdCard.js";
import { authRequired } from "../middleware/authMiddleware.js";
import { enrollFingerprint, getUserBiometricTemplate } from "../services/biometricService.js";
import { anchorRecord, verifyRecordIntegrity } from "../services/recordAnchorService.js";
import { maskAadhaar } from "../utils/masking.js";

const router = express.Router();

// Deterministic visual seed for this user's fingerprint pattern. Derived from
// the biometric template only - same person always renders the same ridges.
const fingerprintSeedFor = (templateId, userId) =>
    crypto.createHash("sha256").update(`${templateId}|${userId}`).digest("hex").slice(0, 32);

// Guarantee every card holder has a biometric enrollment. Registration UI
// captures the simulated fingerprint; if a user skipped/failed that step we
// simulate the enrollment server-side so no citizen is ever card-less.
const ensureBiometric = async (user) => {
    // The template id on the account is only a pointer - the enrolment itself has
    // to exist in the durable store, or verification would fail later on.
    const enrolled = user.fingerprintTemplateId
        ? await getUserBiometricTemplate(user._id.toString())
        : null;
    if (enrolled) {
        return {
            templateId: enrolled.templateId,
            enrolledAt: enrolled.enrolledAt || user.biometricData?.lastEnrolled || new Date()
        };
    }
    const templateId = await enrollFingerprint(user._id.toString(), null);
    user.fingerprintTemplateId = templateId;
    user.biometricData = { fingerprint: templateId, lastEnrolled: new Date() };
    await user.save();
    return { templateId, enrolledAt: user.biometricData.lastEnrolled };
};

const buildSnapshot = (user, bio) => {
    let organization = "";
    let gstin = "";
    if (user.role === "dealer") {
        organization = user.dealerDetails?.businessName || "";
        gstin = user.dealerDetails?.gstin || "";
    } else if (user.role === "workshop") {
        organization = [user.workshopDetails?.companyName, user.workshopDetails?.affiliatedManufacturer]
            .filter(Boolean).join(" • ");
        gstin = user.workshopDetails?.gstin || "";
    } else if (user.role === "rto") {
        organization = user.rtoDetails?.rtoOfficeName || "";
    }
    return {
        holder: {
            name: user.name,
            role: user.role,
            email: user.email,
            phone: user.phone || "",
            address: user.address || "",
            state: user.state || "",
            district: user.district || "",
            hasPhoto: !!user.profilePhoto?.data?.length
        },
        identifiers: {
            aadhaarMasked: maskAadhaar(user.aadhaarNumber),
            dlNumber: user.dlNumber || "",
            badgeNumber: user.badgeNumber || "",
            employeeId: user.rtoDetails?.employeeId || "",
            gstin,
            organization,
            did: user.did?.identifier || "",
            biochainDid: user.did?.biochainDid || "",
            walletAddress: user.blockchainWalletAddress || ""
        },
        biometric: {
            enrolled: true,
            templateId: bio.templateId,
            fingerprintSeed: fingerprintSeedFor(bio.templateId, user._id.toString()),
            algorithm: "simulated-fingerprint-v1",
            enrolledAt: bio.enrolledAt
        },
        kyc: {
            documentType: user.kyc?.documentType || "",
            extractedViaOcr: !!user.kyc?.extractedViaOcr,
            verifiedAt: user.kyc?.verifiedAt || null
        }
    };
};

// GET /api/id-card/me - the signed-in citizen's card (if issued yet)
// The card is a snapshot, and a snapshot is never quietly rewritten - that would
// break the hash recorded under it. So when the account has gained a DID, a
// wallet or a new name since the card was issued, the response says which
// details are out of date and the holder re-issues a new version.
router.get("/me", authRequired, async (req, res) => {
    const card = await UserIdCard.findOne({ user: req.user.id });
    if (!card) return res.json({ hasCard: false });

    const user = await User.findById(req.user.id).select(
        "name email phone address state district did blockchainWalletAddress profilePhoto"
    );
    const outOfDate = [];
    if (user) {
        if ((user.did?.identifier || "") && card.identifiers?.did !== user.did.identifier) outOfDate.push("Decentralized Identifier");
        if ((user.blockchainWalletAddress || "") && card.identifiers?.walletAddress !== user.blockchainWalletAddress) outOfDate.push("wallet address");
        if (card.holder?.name !== user.name) outOfDate.push("name");
        if (!!user.profilePhoto?.data?.length !== !!card.holder?.hasPhoto) outOfDate.push("photograph");
    }

    res.json({ hasCard: true, card, outOfDate });
});

// POST /api/id-card/me - issue the card (or re-issue a newer version when the
// profile has changed). The card content is hashed and anchored on-chain.
router.post("/me", authRequired, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ message: "User not found" });

        const bio = await ensureBiometric(user);
        const existing = await UserIdCard.findOne({ user: user._id });

        const issuedAt = new Date();
        const snapshot = buildSnapshot(user, bio);
        const content = {
            user: user._id, // included so later integrity verification re-hashes the exact same field set
            cardNumber: existing?.cardNumber ||
                `BCH-ID-${crypto.randomBytes(4).toString("hex").toUpperCase()}-${String(user._id).slice(-4).toUpperCase()}`,
            version: (existing?.version || 0) + 1,
            issuedAt,
            ...snapshot
        };

        const anchor = await anchorRecord(content, "digital-id-card");

        const card = existing || new UserIdCard({ user: user._id });
        Object.assign(card, content, { anchor });
        await card.save();

        res.json({ message: existing ? "Digital ID Card re-issued with latest details" : "Digital ID Card issued", card });
    } catch (err) {
        console.error("id-card issue error:", err.message);
        res.status(500).json({ message: "Could not issue the Digital ID Card" });
    }
});

// GET /api/id-card/me/verify - prove the stored card still matches its anchor hash
router.get("/me/verify", authRequired, async (req, res) => {
    const card = await UserIdCard.findOne({ user: req.user.id });
    if (!card) return res.status(404).json({ verified: false, reason: "No Digital ID Card issued yet." });
    res.json(verifyRecordIntegrity(card));
});

export default router;
