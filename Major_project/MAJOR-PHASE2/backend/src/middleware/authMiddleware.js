import jwt from "jsonwebtoken";
import { User } from "../models/User.js";
import { verifyFingerprint } from "../services/biometricService.js";

export const authRequired = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization || "";
        const token = authHeader.startsWith("Bearer ")
            ? authHeader.slice(7)
            : null;

        if (!token) {
            return res.status(401).json({ message: "No token provided" });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET || "dev_secret");
        const user = await User.findById(decoded.userId);

        if (!user) {
            return res.status(401).json({ message: "Invalid token user" });
        }

        req.user = {
            id: user._id.toString(), // Store as string for easier comparison
            role: user.role,
            name: user.name,
            email: user.email,
            verificationStatus: user.verificationStatus
        };

        next();
    } catch (err) {
        console.error("authRequired error:", err.message);
        res.status(401).json({ message: "Unauthorized" });
    }
};

// Middleware for routes that require biometric verification
export const biometricRequired = async (req, res, next) => {
    try {
        if (!req.user) {
            return res.status(401).json({ message: "Authentication required" });
        }

        // Verify biometric data from request body
        const { biometricData } = req.body;
        if (!biometricData) {
            return res.status(400).json({ message: "Biometric data required for this operation" });
        }

        // Perform biometric verification
        const verificationResult = await verifyFingerprint(req.user.id, biometricData);

        if (!verificationResult.success) {
            return res.status(401).json({
                message: "Biometric verification failed",
                details: verificationResult.message
            });
        }

        // Add biometric verification info to request
        req.biometricVerification = {
            templateId: verificationResult.templateId,
            timestamp: new Date(),
            success: true
        };

        next();
    } catch (err) {
        console.error("biometricRequired error:", err.message);
        res.status(500).json({ message: "Biometric verification error" });
    }
};

export const requireRole = (...allowedRoles) => {
    return (req, res, next) => {
        if (!req.user || !allowedRoles.includes(req.user.role)) {
            return res.status(403).json({ message: "Forbidden" });
        }
        next();
    };
};
