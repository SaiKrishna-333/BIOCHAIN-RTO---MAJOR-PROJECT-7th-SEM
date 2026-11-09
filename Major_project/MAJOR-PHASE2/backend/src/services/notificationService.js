// notificationService.js
// Handles all notification generation and delivery for BioChain RTO

import { Notification } from "../models/Notification.js";
import { User } from "../models/User.js";
import { emitToUser, emitToRole, emitTheftAlert, emitNotification } from "./socketService.js";
import { sendTheftAlertEmail, sendApprovalEmail, sendRejectionEmail } from "./emailService.js";
import { sendTheftAlertSMS, sendApprovalSMS, sendRejectionSMS, sendRecoverySMS } from "./smsService.js";

/**
 * Create a notification for a specific user
 */
export const createNotification = async ({
    type,
    title,
    message,
    recipient,
    recipientRole,
    relatedVehicle = null,
    relatedRequest = null,
    requestModel = null,
    priority = "medium",
    actionRequired = false,
    actionUrl = null,
    metadata = {}
}) => {
    try {
        const notification = new Notification({
            type,
            title,
            message,
            recipient,
            recipientRole,
            relatedVehicle,
            relatedRequest,
            requestModel,
            priority,
            actionRequired,
            actionUrl,
            metadata
        });

        await notification.save();

        // Live push so the recipient's bell updates instantly (socket optional)
        try {
            emitNotification(String(recipient), {
                notificationId: String(notification._id),
                type,
                title,
                message,
                actionUrl: actionUrl || null
            });
        } catch (_) {
            /* sockets not initialized - REST list still shows it */
        }

        return notification;
    } catch (error) {
        console.error("Error creating notification:", error.message);
        throw error;
    }
};

/**
 * Create notifications for all users with a specific role
 */
export const createRoleNotification = async ({
    type,
    title,
    message,
    role,
    relatedVehicle = null,
    relatedRequest = null,
    requestModel = null,
    priority = "medium",
    actionRequired = false,
    actionUrl = null,
    metadata = {}
}) => {
    try {
        // Find all users with the specified role
        const users = await User.find({ role });

        const notifications = await Promise.all(
            users.map(user =>
                createNotification({
                    type,
                    title,
                    message,
                    recipient: user._id,
                    recipientRole: role,
                    relatedVehicle,
                    relatedRequest,
                    requestModel,
                    priority,
                    actionRequired,
                    actionUrl,
                    metadata
                })
            )
        );

        console.log(`Created ${notifications.length} notification(s) for role ${role}`);
        return notifications;
    } catch (error) {
        console.error("Error creating role notifications:", error.message);
        throw error;
    }
};

/**
 * Send theft alert to all RTO officers and police
 * Triggered when a vehicle is reported stolen
 */
export const sendTheftAlert = async (vehicle, theftReport, reporter) => {
    try {
        const alertTitle = `THEFT ALERT: Vehicle ${vehicle.regNumber} Reported Stolen`;
        const alertMessage = `
Vehicle ${vehicle.regNumber} (${vehicle.make} ${vehicle.model}) has been reported stolen.
FIR Number: ${theftReport.firNumber}
Police Station: ${theftReport.policeStation}
Incident Location: ${theftReport.incidentLocation}
Reporter: ${reporter.name}

IMMEDIATE ACTION REQUIRED: Do not process any transfers for this vehicle.
        `.trim();

        // Send to all RTO officers
        await createRoleNotification({
            type: "theft_alert",
            title: alertTitle,
            message: alertMessage,
            role: "rto",
            relatedVehicle: vehicle._id,
            relatedRequest: theftReport._id,
            requestModel: "TheftReport",
            priority: "critical",
            actionRequired: true,
            actionUrl: `/police/theft-reports`,
            metadata: {
                regNumber: vehicle.regNumber,
                firNumber: theftReport.firNumber,
                incidentLocation: theftReport.incidentLocation
            }
        });

        // Send to all police officers
        await createRoleNotification({
            type: "theft_alert",
            title: alertTitle,
            message: alertMessage,
            role: "police",
            relatedVehicle: vehicle._id,
            relatedRequest: theftReport._id,
            requestModel: "TheftReport",
            priority: "critical",
            actionRequired: true,
            actionUrl: `/police/theft-reports`,
            metadata: {
                regNumber: vehicle.regNumber,
                firNumber: theftReport.firNumber,
                incidentLocation: theftReport.incidentLocation
            }
        });

        // Send to vehicle owner (confirmation)
        await createNotification({
            type: "theft_alert",
            title: "Theft Report Submitted Successfully",
            message: `Your vehicle ${vehicle.regNumber} has been reported as stolen and blocked from transfers. Police and RTO have been notified.`,
            recipient: reporter._id,
            recipientRole: "owner",
            relatedVehicle: vehicle._id,
            relatedRequest: theftReport._id,
            requestModel: "TheftReport",
            priority: "high",
            metadata: {
                regNumber: vehicle.regNumber,
                firNumber: theftReport.firNumber
            }
        });

        // Real-time WebSocket alerts
        emitTheftAlert(vehicle, theftReport);

        // Send Email notifications
        try {
            const rtoUsers = await User.find({ role: "rto" });
            const policeUsers = await User.find({ role: "police" });

            for (const user of [...rtoUsers, ...policeUsers]) {
                if (user.email) {
                    await sendTheftAlertEmail(user.email, vehicle, theftReport);
                }
            }

            if (reporter.email) {
                await sendTheftAlertEmail(reporter.email, vehicle, theftReport);
            }
        } catch (emailErr) {
            console.error("Failed to send theft alert emails:", emailErr.message);
        }

        // Send SMS notifications
        try {
            const rtoUsers = await User.find({ role: "rto" });
            const policeUsers = await User.find({ role: "police" });

            for (const user of [...rtoUsers, ...policeUsers]) {
                // Officers carry a plain phone; only dealers have dealerDetails.
                // Reading just the dealer field meant an officer's SMS was never
                // attempted, however badly the vehicle was needed.
                const phone = user.phone || user.dealerDetails?.phone;
                if (phone) {
                    await sendTheftAlertSMS(phone, vehicle, theftReport);
                }
            }
        } catch (smsErr) {
            console.error("Failed to send theft alert SMS:", smsErr.message);
        }

        console.log(`Theft alert dispatched for ${vehicle.regNumber}`);
    } catch (error) {
        console.error("Error sending theft alert:", error.message);
        throw error;
    }
};

/**
 * Send notification when vehicle is recovered
 */
export const sendRecoveryAlert = async (vehicle, theftReport) => {
    try {
        const alertTitle = `RECOVERY: Vehicle ${vehicle.regNumber} Recovered`;
        const alertMessage = `
Vehicle ${vehicle.regNumber} (${vehicle.make} ${vehicle.model}) has been recovered.
FIR Number: ${theftReport.firNumber}
Recovery Date: ${theftReport.recoveryDate}
Recovery Location: ${theftReport.recoveryLocation}

The vehicle status has been updated to ACTIVE. Transfers can now be processed.
        `.trim();

        // Notify RTO officers
        await createRoleNotification({
            type: "system",
            title: alertTitle,
            message: alertMessage,
            role: "rto",
            relatedVehicle: vehicle._id,
            priority: "high",
            metadata: {
                regNumber: vehicle.regNumber,
                status: "recovered"
            }
        });

        // Notify police
        await createRoleNotification({
            type: "system",
            title: alertTitle,
            message: alertMessage,
            role: "police",
            relatedVehicle: vehicle._id,
            priority: "high",
            metadata: {
                regNumber: vehicle.regNumber,
                status: "recovered"
            }
        });

        console.log(`Recovery alert dispatched for ${vehicle.regNumber}`);
    } catch (error) {
        console.error("Error sending recovery alert:", error.message);
        throw error;
    }
};

/**
 * Notify RTO officers of new transfer request
 */
export const notifyRTOOfTransferRequest = async (request, vehicle, requester) => {
    try {
        const isNewRegistration = request.type === "newRegistration";
        const title = isNewRegistration
            ? `New Registration Request: ${vehicle.make} ${vehicle.model}`
            : `Transfer Request: ${vehicle.regNumber}`;

        const message = isNewRegistration
            ? `Dealer ${requester.name} has submitted a new vehicle registration request for ${vehicle.make} ${vehicle.model} (${vehicle.year}).`
            : `Owner ${requester.name} has requested to transfer vehicle ${vehicle.regNumber} to a new owner.`;

        await createRoleNotification({
            type: "transfer_request",
            title,
            message,
            role: "rto",
            relatedVehicle: vehicle._id,
            relatedRequest: request._id,
            requestModel: "Request",
            priority: "medium",
            actionRequired: true,
            actionUrl: `/rto/dashboard`,
            metadata: {
                requestType: request.type,
                requesterName: requester.name,
                vehicleDetails: `${vehicle.make} ${vehicle.model}`
            }
        });

        console.log(`RTO notified of a ${request.type} request`);
    } catch (error) {
        console.error("Error notifying RTO:", error.message);
        throw error;
    }
};

/**
 * Notify user of request approval
 */
export const notifyApproval = async (request, vehicle, recipient) => {
    try {
        const isNewRegistration = request.type === "newRegistration";
        const title = isNewRegistration
            ? `Registration Approved: ${vehicle.regNumber}`
            : `Transfer Approved: ${vehicle.regNumber}`;

        const message = isNewRegistration
            ? `Your vehicle registration has been approved. Registration Number: ${vehicle.regNumber}. You can now download your Digital RC.`
            : `Your vehicle transfer request has been approved. You are now the registered owner of ${vehicle.regNumber}.`;

        await createNotification({
            type: "approval",
            title,
            message,
            recipient: recipient._id,
            recipientRole: recipient.role,
            relatedVehicle: vehicle._id,
            relatedRequest: request._id,
            requestModel: "Request",
            priority: "high",
            actionUrl: `/documents`,
            metadata: {
                regNumber: vehicle.regNumber,
                txHash: vehicle.blockchainTxHash
            }
        });

        console.log(`Approval notification recorded for a ${recipient.role}`);
    } catch (error) {
        console.error("Error sending approval notification:", error.message);
        throw error;
    }
};

/**
 * Notify user of request rejection
 */
export const notifyRejection = async (request, recipient, remarks = "") => {
    try {
        const title = "Request Rejected";
        const message = remarks
            ? `Your request has been rejected. Reason: ${remarks}`
            : "Your request has been rejected. Please contact RTO for more information.";

        await createNotification({
            type: "rejection",
            title,
            message,
            recipient: recipient._id,
            recipientRole: recipient.role,
            relatedRequest: request._id,
            requestModel: "Request",
            priority: "high",
            metadata: {
                rejectionReason: remarks
            }
        });

        console.log(`Rejection notification recorded for a ${recipient.role}`);
    } catch (error) {
        console.error("Error sending rejection notification:", error.message);
        throw error;
    }
};

/**
 * Get unread notifications for a user
 */
export const getUnreadNotifications = async (userId, limit = 20) => {
    try {
        const notifications = await Notification.find({
            recipient: userId,
            status: "unread"
        })
            .sort({ createdAt: -1 })
            .limit(limit)
            .populate("relatedVehicle", "regNumber make model");

        return notifications;
    } catch (error) {
        console.error("Error fetching unread notifications:", error.message);
        throw error;
    }
};

/**
 * Mark notification as read
 */
export const markAsRead = async (notificationId) => {
    try {
        const notification = await Notification.findByIdAndUpdate(
            notificationId,
            { status: "read" },
            { new: true }
        );
        return notification;
    } catch (error) {
        console.error("Error marking notification as read:", error.message);
        throw error;
    }
};

/**
 * Get notification count for a user
 */
export const getNotificationCount = async (userId) => {
    try {
        const unreadCount = await Notification.countDocuments({
            recipient: userId,
            status: "unread"
        });

        const totalCount = await Notification.countDocuments({
            recipient: userId
        });

        return { unread: unreadCount, total: totalCount };
    } catch (error) {
        console.error("Error getting notification count:", error.message);
        throw error;
    }
};
