import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { User } from "../models/User.js";
import { enrollFingerprint } from "../services/biometricService.js";
import { generateDID } from "../services/didService.js";
import { authRequired } from "../middleware/authMiddleware.js";
import multer from "multer";

const router = express.Router();

// An Aadhaar is only ever shown in full to the account it belongs to. Any other
// viewer - including an RTO or police officer - gets the masked form, which is
// enough to recognise a person and not enough to impersonate them.
const aadhaarForViewer = (user, isSelf) => {
    if (!user.aadhaarNumber) return "";
    if (isSelf) return user.aadhaarNumber;
    const digits = String(user.aadhaarNumber).replace(/\D/g, "");
    return digits.length >= 4 ? `XXXX XXXX ${digits.slice(-4)}` : "XXXX XXXX XXXX";
};

// A photo exists only when there are bytes behind it. An empty profilePhoto
// object used to advertise "has photo" and then return nothing to display.
const hasPhotoBytes = (user) => Boolean(user.profilePhoto?.data?.length);

// Configure multer for file uploads
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB limit
    },
});

router.post("/register", upload.single("profilePhoto"), async (req, res) => {
    try {
        const { name, email, password, role, phone, address, state, district, aadhaarNumber, dlNumber, badgeNumber, dealerDetails, workshopDetails, kycDocType, kycViaOcr } = req.body;

        const existing = await User.findOne({ email });
        if (existing) {
            return res.status(400).json({ message: "Email already registered" });
        }

        const passwordHash = await bcrypt.hash(password, 10);

        const user = new User({
            name,
            email,
            passwordHash,
            role,
            phone,
            address,
            state,
            district,
            aadhaarNumber,
            dlNumber,
            badgeNumber // Save badge number for police users
        });

        // Save profile photo if uploaded
        if (req.file) {
            user.profilePhoto = {
                data: req.file.buffer,
                contentType: req.file.mimetype
            };
        }

        // Add dealer-specific details if role is dealer
        if (role === "dealer" && dealerDetails) {
            user.dealerDetails = dealerDetails;
        }

        // Add workshop-specific details if role is workshop (company affiliation etc.)
        if (role === "workshop" && workshopDetails) {
            const details = typeof workshopDetails === "string" ? JSON.parse(workshopDetails) : workshopDetails;
            user.workshopDetails = {
                companyName: details.companyName || "",
                affiliatedManufacturer: details.affiliatedManufacturer || "",
                gstin: details.gstin || "",
                licenseNumber: details.licenseNumber || "",
                address: details.address || "",
                phone: details.phone || "",
                verified: false
            };
        }

        // Record the KYC provenance when the form was auto-filled from an
        // uploaded government document via OCR (optional - manual entry still works)
        if (kycDocType || kycViaOcr) {
            user.kyc = {
                documentType: kycDocType || "id-document",
                extractedViaOcr: kycViaOcr === true || kycViaOcr === "true",
                verifiedAt: new Date()
            };
        }

        await user.save();

        // Simulated biometric enrollment happens for EVERY new user at this
        // point, so a fingerprint template is always stored even if the UI
        // capture modal is dismissed. When the user completes the on-screen
        // capture, its fresher template overwrites this one via the public
        // PUT /register/:id/biometric endpoint below.
        try {
            const templateId = await enrollFingerprint(user._id.toString(), null);
            user.fingerprintTemplateId = templateId;
            user.biometricData = { fingerprint: templateId, lastEnrolled: new Date() };
        } catch (bioErr) {
            console.error("Simulated biometric enrollment failed:", bioErr.message);
        }

        // Generate DID for the user
        try {
            const didData = await generateDID(user._id.toString(), role);
            user.did = {
                identifier: didData.did,
                biochainDid: didData.biochainDid,
                document: didData.didDocument,
                createdAt: new Date()
            };
            user.blockchainWalletAddress = didData.address;
            console.log(`DID generated for user ${user._id}: ${didData.did}`);
        } catch (didErr) {
            console.error("Failed to generate DID:", didErr.message);
            // Don't fail registration if DID generation fails
        }

        await user.save();

        res.status(201).json({
            message: "User registered",
            userId: user._id,
            did: user.did?.identifier || null
        });
    } catch (err) {
        // A duplicate identity number is the applicant's mistake, not a server
        // fault, and "Server error" hides it. Name the field so they can fix it.
        if (err?.code === 11000) {
            const field = Object.keys(err.keyValue || {})[0] || "identity number";
            const label = { aadhaarNumber: "Aadhaar number", dlNumber: "Driving licence number", "rtoDetails.employeeId": "Employee ID", "did.identifier": "Decentralized identifier" }[field] || field;
            console.warn(`Registration rejected for ${req.body?.email}: ${field} already on file`);
            return res.status(409).json({ message: `${label} is already registered with another account.` });
        }
        console.error("register error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Public endpoint to update biometric after registration (no auth required)
router.put("/register/:id/biometric", async (req, res) => {
    try {
        const { id } = req.params;
        const { templateId, quality } = req.body;

        const user = await User.findById(id);
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        // Update biometric data with the captured template
        user.fingerprintTemplateId = templateId;
        user.biometricData = {
            fingerprint: templateId,
            lastEnrolled: new Date()
        };

        await user.save();

        res.json({
            message: "Biometric data updated successfully",
            templateId: user.fingerprintTemplateId,
            quality
        });
    } catch (err) {
        console.error("update biometric error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

router.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        const user = await User.findOne({ email });

        if (!user || !user.passwordHash) {
            // Only the failure is worth a line: morgan already logs the request,
            // and a successful login needs no trace of the address in the log.
            console.log(`Login refused: no account or no password hash for ${email}`);
            return res.status(400).json({ message: "Invalid credentials" });
        }

        const match = await bcrypt.compare(password, user.passwordHash);
        if (!match) {
            console.log(`Login refused: password mismatch for ${email}`);
            return res.status(400).json({ message: "Invalid credentials" });
        }

        const token = jwt.sign(
            { userId: user._id },
            process.env.JWT_SECRET || "dev_secret",
            { expiresIn: "8h" }
        );

        res.json({
            token,
            user: {
                id: user._id.toString(), // Return as string for consistency
                name: user.name,
                email: user.email,
                role: user.role,
                phone: user.phone || null,
                address: user.address || null,
                state: user.state || null,
                district: user.district || null,
                aadhaarNumber: user.aadhaarNumber || null,
                dlNumber: user.dlNumber || null,
                hasProfilePhoto: hasPhotoBytes(user), // Indicate if photo exists
                did: user.did?.identifier || null,
                biochainDid: user.did?.biochainDid || null,
                dealerDetails: user.dealerDetails,
                rtoDetails: user.rtoDetails,
                workshopDetails: user.workshopDetails
            }
        });
    } catch (err) {
        console.error("login error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Route to update dealer details (handle both with and without trailing slash)
router.put("/update-dealer-details", authRequired, async (req, res) => {
    try {
        const userId = req.user.id;
        const { dealerDetails } = req.body;

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        if (user.role !== "dealer") {
            return res.status(403).json({ message: "Only dealers can update dealer details" });
        }

        // Initialize dealerDetails if it doesn't exist, then merge
        user.dealerDetails = {
            businessName: '',
            gstin: '',
            tin: '',
            licenseNumber: '',
            showroomAddress: '',
            contactPerson: '',
            contactPhone: '',
            contactEmail: '',
            phone: '',
            ...user.dealerDetails, // Keep existing values
            ...dealerDetails // Override with new values
        };

        await user.save();

        res.json({
            message: "Dealer details updated successfully",
            dealerDetails: user.dealerDetails
        });
    } catch (err) {
        console.error("update dealer details error:", err.message);
        console.error("Stack trace:", err.stack);
        res.status(500).json({ message: "Server error" });
    }
});

// Route to update RTO details
router.put("/update-rto-details", authRequired, async (req, res) => {
    try {
        const userId = req.user.id;
        const { rtoDetails } = req.body;

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        if (user.role !== "rto") {
            return res.status(403).json({ message: "Only RTO officers can update RTO details" });
        }

        // Initialize and update RTO details
        user.rtoDetails = {
            stateCode: '',
            stateName: '',
            district: '',
            rtoOfficeCode: '',
            rtoOfficeName: '',
            designation: '',
            employeeId: '',
            officeAddress: '',
            jurisdiction: '',
            ...user.rtoDetails,
            ...rtoDetails
        };

        await user.save();

        res.json({
            message: "RTO details updated successfully",
            rtoDetails: user.rtoDetails
        });
    } catch (err) {
        console.error("update RTO details error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Route to update workshop details (company affiliation, license etc.)
router.put("/update-workshop-details", authRequired, async (req, res) => {
    try {
        const userId = req.user.id;
        const { workshopDetails } = req.body;

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        if (user.role !== "workshop") {
            return res.status(403).json({ message: "Only workshops can update workshop details" });
        }

        user.workshopDetails = {
            companyName: '',
            affiliatedManufacturer: '',
            gstin: '',
            licenseNumber: '',
            address: '',
            phone: '',
            ...user.workshopDetails,
            ...workshopDetails,
            // Verification can only be granted by admin/RTO, never self-declared
            verified: user.workshopDetails?.verified || false
        };

        await user.save();

        res.json({
            message: "Workshop details updated successfully",
            workshopDetails: user.workshopDetails
        });
    } catch (err) {
        console.error("update workshop details error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Update user profile
router.put("/users/:id", authRequired, async (req, res) => {
    try {
        const { id } = req.params;

        // Verify user can only update their own profile
        // Convert both to strings for proper comparison
        if (id.toString() !== req.user.id.toString()) {
            console.log(`Profile update rejected: URL id=${id}, Authenticated user id=${req.user.id}`);
            return res.status(403).json({ message: "Unauthorized to update this profile" });
        }

        const { name, phone, address, aadhaarNumber, dlNumber } = req.body;

        const user = await User.findById(id);
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        // Update allowed fields
        if (name) user.name = name;
        if (phone) user.phone = phone;
        if (address) user.address = address;
        if (aadhaarNumber) user.aadhaarNumber = aadhaarNumber;
        if (dlNumber) user.dlNumber = dlNumber;

        await user.save();

        res.json({
            message: "Profile updated successfully",
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                phone: user.phone,
                address: user.address,
                aadhaarNumber: user.aadhaarNumber,
                dlNumber: user.dlNumber,
                role: user.role
            }
        });
    } catch (err) {
        console.error("update profile error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Get user profile by ID
router.get("/users/:id", authRequired, async (req, res) => {
    try {
        const { id } = req.params;

        // Allow users to view their own profile, or RTO/police to view any profile
        const isOwnProfile = id === req.user.id;
        const isAdmin = req.user.role === "rto" || req.user.role === "police";

        if (!isOwnProfile && !isAdmin) {
            return res.status(403).json({ message: "Unauthorized to access this profile" });
        }

        const user = await User.findById(id);
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        res.json({
            id: user._id,
            name: user.name,
            email: user.email,
            phone: user.phone || "",
            address: user.address || "",
            aadhaarNumber: aadhaarForViewer(user, isOwnProfile),
            dlNumber: user.dlNumber || "",
            hasProfilePhoto: hasPhotoBytes(user)
        });
    } catch (err) {
        console.error("get user profile error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Get user profile photo
router.get("/users/:id/photo", authRequired, async (req, res) => {
    try {
        const { id } = req.params;

        const user = await User.findById(id);
        if (!user || !hasPhotoBytes(user)) {
            return res.status(404).json({ message: "No profile photo on this account" });
        }

        res.set('Content-Type', user.profilePhoto.contentType || 'application/octet-stream');
        res.send(user.profilePhoto.data);
    } catch (err) {
        console.error("get user photo error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Update user biometric data
router.put("/:id/biometric", authRequired, async (req, res) => {
    try {
        const { id } = req.params;
        const { templateId, quality } = req.body;

        // Verify user can only update their own biometric data
        // Convert both to strings for proper comparison
        if (id.toString() !== req.user.id.toString()) {
            return res.status(403).json({ message: "Unauthorized to update this biometric data" });
        }

        const user = await User.findById(id);
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        // Update biometric data
        user.fingerprintTemplateId = templateId;
        user.biometricData = {
            fingerprint: templateId,
            lastEnrolled: new Date()
        };

        await user.save();

        res.json({
            message: "Biometric data updated successfully",
            templateId: user.fingerprintTemplateId,
            quality
        });
    } catch (err) {
        console.error("update biometric error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Update user profile photo
router.put("/:id/photo", authRequired, upload.single("profilePhoto"), async (req, res) => {
    try {
        const { id } = req.params;

        // Verify user can only update their own photo
        // Convert both to strings for proper comparison
        if (id.toString() !== req.user.id.toString()) {
            return res.status(403).json({ message: "Unauthorized to update this photo" });
        }

        if (!req.file) {
            return res.status(400).json({ message: "No photo file provided" });
        }

        const user = await User.findById(id);
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        // Update profile photo
        user.profilePhoto = {
            data: req.file.buffer,
            contentType: req.file.mimetype
        };

        await user.save();

        res.json({
            message: "Profile photo updated successfully",
            hasProfilePhoto: true
        });
    } catch (err) {
        console.error("update photo error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

export default router;
