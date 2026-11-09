// biometricService.js
// Fingerprint enrolment and matching for ownership-critical operations.
//
// HONEST SCOPE: no scanner SDK is wired up on this machine, so the template bytes
// and the match score are simulated (see BIOMETRIC_SIMULATION_GUIDE.md). What is
// real is the enrolment record: it lives in MongoDB, so a restart does not
// un-enrol every user and biometric-gated operations keep working across
// processes. Swapping simulateBiometricMatch() for an SDK call is the only change
// needed to run this against hardware.

import { BiometricTemplate } from "../models/BiometricTemplate.js";

export const enrollFingerprint = async (userId, rawFingerprintData) => {
    try {
        // In a real implementation, this would process the raw fingerprint data
        // and generate a secure biometric template
        const templateId = generateSecureTemplateId(userId);

        await BiometricTemplate.create({
            user: userId,
            templateId,
            template: rawFingerprintData || `encrypted_template_for_${userId}`,
            enrolledAt: new Date(),
            status: 'active'
        });

        return templateId;
    } catch (error) {
        console.error('Error enrolling fingerprint:', error.message);
        throw error;
    }
};

export const verifyFingerprint = async (userId, rawFingerprintData) => {
    try {
        // Newest enrolment wins: re-scanning replaces the previous template
        const stored = await getUserBiometricTemplate(userId);

        if (!stored) {
            return {
                success: false,
                message: "No enrolled fingerprint found for this user"
            };
        }

        const isValid = simulateBiometricMatch(stored, rawFingerprintData);

        const result = {
            success: isValid,
            message: isValid ? "Fingerprint verification successful" : "Fingerprint verification failed",
            templateId: stored.templateId
        };

        if (!isValid) console.warn(`Fingerprint verification failed for user ${userId}`);

        return result;
    } catch (error) {
        console.error('Error verifying fingerprint:', error.message);
        return {
            success: false,
            message: `Fingerprint verification error: ${error.message}`
        };
    }
};

// Function to generate a secure template ID
function generateSecureTemplateId(userId) {
    return `bio_${userId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Function to simulate biometric matching (in production, use SDK)
function simulateBiometricMatch(storedTemplate, inputTemplate) {
    // In a real implementation, this would use the biometric SDK's matching algorithm
    // For demo purposes, we'll return true 95% of the time to simulate a realistic scenario
    return Math.random() > 0.05; // 95% success rate
}

// Function to get user's biometric template
export const getUserBiometricTemplate = async (userId) => {
    try {
        const doc = await BiometricTemplate.findOne({ user: userId, status: 'active' })
            .sort({ enrolledAt: -1 })
            .lean();
        if (!doc) return null;
        return {
            templateId: doc.templateId,
            userId: String(doc.user),
            template: doc.template,
            enrolledAt: doc.enrolledAt,
            status: doc.status
        };
    } catch (error) {
        console.error('Error reading biometric template:', error.message);
        return null;
    }
};
