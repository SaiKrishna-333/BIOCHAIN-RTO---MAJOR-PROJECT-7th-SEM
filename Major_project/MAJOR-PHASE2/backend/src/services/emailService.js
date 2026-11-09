// emailService.js
// Service for sending email notifications

import nodemailer from "nodemailer";

// Create transporter
const createTransporter = () => {
    // Use environment variables for email configuration
    const host = process.env.EMAIL_HOST || "smtp.gmail.com";
    const port = parseInt(process.env.EMAIL_PORT || "587");
    const user = process.env.EMAIL_USER || "";
    const pass = process.env.EMAIL_PASS || "";

    if (!user || !pass) {
        // A deliberate demo state, not a fault - stated once as a fact so it is
        // not read as an error in the startup log.
        console.log("[email] No SMTP credentials configured: each message is recorded in this log instead of being sent");
        return null;
    }

    return nodemailer.createTransporter({
        host,
        port,
        secure: port === 465,
        auth: { user, pass }
    });
};

const transporter = createTransporter();

/**
 * Send email
 * @param {string} to - Recipient email
 * @param {string} subject - Email subject
 * @param {string} html - HTML content
 * @param {string} text - Plain text content (fallback)
 */
export const sendEmail = async (to, subject, html, text = "") => {
    try {
        if (!transporter) {
            console.log(`[EMAIL MOCK] To: ${to}, Subject: ${subject}`);
            return { mock: true, to, subject };
        }

        const from = process.env.EMAIL_FROM || "BioChain RTO <noreply@biochainrto.com>";

        const info = await transporter.sendMail({
            from,
            to,
            subject,
            text,
            html
        });

        console.log(`Email sent to ${to}: ${info.messageId}`);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        console.error("Error sending email:", error.message);
        throw error;
    }
};

/**
 * Send theft alert email
 */
export const sendTheftAlertEmail = async (to, vehicle, theftReport) => {
    const subject = `THEFT ALERT: Vehicle ${vehicle.regNumber} Reported Stolen`;

    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: #dc2626; color: white; padding: 20px; text-align: center;">
                <h1>THEFT ALERT</h1>
            </div>
            <div style="padding: 20px; border: 1px solid #e5e7eb;">
                <h2>Vehicle Theft Reported</h2>
                <p><strong>Registration Number:</strong> ${vehicle.regNumber}</p>
                <p><strong>Vehicle:</strong> ${vehicle.make} ${vehicle.model} (${vehicle.year})</p>
                <p><strong>FIR Number:</strong> ${theftReport.firNumber}</p>
                <p><strong>Police Station:</strong> ${theftReport.policeStation}</p>
                <p><strong>Incident Location:</strong> ${theftReport.incidentLocation}</p>
                <p><strong>Date:</strong> ${new Date(theftReport.incidentDate).toLocaleDateString()}</p>
                
                <div style="background: #fef3c7; padding: 15px; margin: 20px 0; border-left: 4px solid #f59e0b;">
                    <p style="margin: 0;"><strong>ACTION REQUIRED:</strong> Do not process any transfers for this vehicle.</p>
                </div>
                
                <p style="color: #6b7280; font-size: 12px;">
                    This is an automated alert from BioChain RTO system.
                </p>
            </div>
        </div>
    `;

    const text = `THEFT ALERT: Vehicle ${vehicle.regNumber} (${vehicle.make} ${vehicle.model}) has been reported stolen. FIR: ${theftReport.firNumber}. Do not process any transfers.`;

    return sendEmail(to, subject, html, text);
};

/**
 * Send approval email
 */
export const sendApprovalEmail = async (to, requestType, vehicle, txHash) => {
    const isNewRegistration = requestType === "newRegistration";
    const subject = isNewRegistration
        ? `Registration Approved: ${vehicle.regNumber}`
        : `Transfer Approved: ${vehicle.regNumber}`;

    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: #059669; color: white; padding: 20px; text-align: center;">
                <h1>APPROVED</h1>
            </div>
            <div style="padding: 20px; border: 1px solid #e5e7eb;">
                <h2>${isNewRegistration ? 'Vehicle Registration Approved' : 'Ownership Transfer Approved'}</h2>
                <p><strong>Registration Number:</strong> ${vehicle.regNumber}</p>
                <p><strong>Vehicle:</strong> ${vehicle.make} ${vehicle.model} (${vehicle.year})</p>
                <p><strong>Blockchain Transaction:</strong> ${txHash}</p>
                
                <div style="background: #d1fae5; padding: 15px; margin: 20px 0; border-left: 4px solid #059669;">
                    <p style="margin: 0;">Your Digital RC is now available in your documents section.</p>
                </div>
                
                <p style="color: #6b7280; font-size: 12px;">
                    This is an automated notification from BioChain RTO system.
                </p>
            </div>
        </div>
    `;

    const text = `Your ${isNewRegistration ? 'registration' : 'transfer'} for vehicle ${vehicle.regNumber} has been approved. Transaction: ${txHash}`;

    return sendEmail(to, subject, html, text);
};

/**
 * Send rejection email
 */
export const sendRejectionEmail = async (to, requestType, remarks = "") => {
    const subject = "Request Rejected - BioChain RTO";

    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: #dc2626; color: white; padding: 20px; text-align: center;">
                <h1>REJECTED</h1>
            </div>
            <div style="padding: 20px; border: 1px solid #e5e7eb;">
                <h2>Request Rejected</h2>
                <p>Your ${requestType} request has been reviewed and rejected.</p>
                
                ${remarks ? `<p><strong>Reason:</strong> ${remarks}</p>` : ''}
                
                <div style="background: #fee2e2; padding: 15px; margin: 20px 0; border-left: 4px solid #dc2626;">
                    <p style="margin: 0;">Please contact your nearest RTO office for more information.</p>
                </div>
                
                <p style="color: #6b7280; font-size: 12px;">
                    This is an automated notification from BioChain RTO system.
                </p>
            </div>
        </div>
    `;

    const text = `Your ${requestType} request has been rejected. ${remarks ? `Reason: ${remarks}` : ''}`;

    return sendEmail(to, subject, html, text);
};

/**
 * Send welcome email
 */
export const sendWelcomeEmail = async (to, name) => {
    const subject = "Welcome to BioChain RTO";

    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: #2563eb; color: white; padding: 20px; text-align: center;">
                <h1>Welcome to BioChain RTO</h1>
            </div>
            <div style="padding: 20px; border: 1px solid #e5e7eb;">
                <p>Hello ${name},</p>
                <p>Welcome to BioChain RTO - India's first biometric and blockchain-based vehicle lifecycle management system.</p>
                
                <h3>What you can do:</h3>
                <ul>
                    <li>Register new vehicles with biometric verification</li>
                    <li>Transfer ownership securely using blockchain</li>
                    <li>Access your Digital RC anytime, anywhere</li>
                    <li>Report theft instantly with nationwide alerts</li>
                </ul>
                
                <p style="color: #6b7280; font-size: 12px;">
                    This is an automated welcome message from BioChain RTO system.
                </p>
            </div>
        </div>
    `;

    return sendEmail(to, subject, html, `Welcome to BioChain RTO, ${name}!`);
};
