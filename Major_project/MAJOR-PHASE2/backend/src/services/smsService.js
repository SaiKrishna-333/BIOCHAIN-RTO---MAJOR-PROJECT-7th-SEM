// smsService.js
// Service for sending SMS notifications using Twilio

import twilio from "twilio";

const accountSid = process.env.TWILIO_ACCOUNT_SID || "";
const authToken = process.env.TWILIO_AUTH_TOKEN || "";
const fromNumber = process.env.TWILIO_PHONE_NUMBER || "";

const client = accountSid && authToken ? twilio(accountSid, authToken) : null;

/**
 * Send SMS
 * @param {string} to - Recipient phone number (with country code)
 * @param {string} message - SMS body
 */
export const sendSMS = async (to, message) => {
    try {
        if (!client) {
            console.log(`[SMS MOCK] To: ${to}, Message: ${message}`);
            return { mock: true, to, message };
        }

        // Ensure phone number has country code
        const formattedNumber = to.startsWith("+") ? to : `+91${to}`;

        const result = await client.messages.create({
            body: message,
            from: fromNumber,
            to: formattedNumber
        });

        console.log(`SMS sent to ${to}: ${result.sid}`);
        return { success: true, sid: result.sid };
    } catch (error) {
        console.error("Error sending SMS:", error.message);
        throw error;
    }
};

/**
 * Send theft alert SMS
 */
export const sendTheftAlertSMS = async (to, vehicle, theftReport) => {
    const message = `BIOCHAIN RTO ALERT: Vehicle ${vehicle.regNumber} (${vehicle.make} ${vehicle.model}) reported STOLEN. FIR: ${theftReport.firNumber}. Do NOT process transfers. Incident: ${theftReport.incidentLocation}`;

    return sendSMS(to, message);
};

/**
 * Send approval SMS
 */
export const sendApprovalSMS = async (to, requestType, vehicle) => {
    const type = requestType === "newRegistration" ? "Registration" : "Transfer";
    const message = `BioChain RTO: Your ${type} for ${vehicle.regNumber} (${vehicle.make} ${vehicle.model}) has been APPROVED. Digital RC is now available.`;

    return sendSMS(to, message);
};

/**
 * Send rejection SMS
 */
export const sendRejectionSMS = async (to, requestType) => {
    const type = requestType === "newRegistration" ? "Registration" : "Transfer";
    const message = `BioChain RTO: Your ${type} request has been REJECTED. Please contact RTO for details.`;

    return sendSMS(to, message);
};

/**
 * Send OTP for verification
 */
export const sendOTP = async (to, otp) => {
    const message = `Your BioChain RTO verification code is: ${otp}. Valid for 10 minutes. Do not share this code.`;

    return sendSMS(to, message);
};

/**
 * Send vehicle recovery SMS
 */
export const sendRecoverySMS = async (to, vehicle) => {
    const message = `BioChain RTO: Good news! Your vehicle ${vehicle.regNumber} has been RECOVERED. Status updated to ACTIVE.`;

    return sendSMS(to, message);
};
