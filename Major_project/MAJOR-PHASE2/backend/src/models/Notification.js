import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
    {
        type: {
            type: String,
            enum: [
                "theft_alert", "transfer_request", "approval", "rejection", "system",
                // Workflow types actually emitted by routes/services
                "transfer-offer", "transfer-approved", "registration-approved", "request-rejected",
                "intel-request", "intel-response",
                // Owner-submitted accident evidence awaiting an officer's check
                "accident-evidence",
                // 3D damage & repair intelligence workflow (Feature 9)
                "damage_estimate", "damage_review", "damage_verified",
                // Predictive theft engine froze the vehicle pending an officer's review
                "auto-freeze",
                // Smart Migration Orchestrator: stage task actionable, deadline reminder,
                // overdue escalation and reconciliation exception routing
                "migration_stage", "migration_deadline", "migration_overdue", "migration_exception"
            ],
            required: true
        },
        title: { type: String, required: true },
        message: { type: String, required: true },
        recipient: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        recipientRole: {
            type: String,
            // Every role a User can have, so a notification to a workshop account
            // is never rejected by validation - that silently cost workshops their
            // incoming intel requests.
            enum: ["dealer", "owner", "rto", "police", "admin", "workshop", "all"],
            required: true
        },
        relatedVehicle: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Vehicle"
        },
        relatedRequest: {
            type: mongoose.Schema.Types.ObjectId,
            refPath: "requestModel"
        },
        requestModel: {
            type: String,
            // Whichever collection relatedRequest points at must be named here, or
            // the reference can never be populated back into a real record.
            enum: ["Request", "InheritanceTransfer", "TheftReport", "VehicleIntelRequest"]
        },
        status: {
            type: String,
            enum: ["unread", "read", "archived"],
            default: "unread"
        },
        priority: {
            type: String,
            enum: ["low", "medium", "high", "critical"],
            default: "medium"
        },
        actionRequired: { type: Boolean, default: false },
        actionUrl: { type: String },
        metadata: {
            type: Map,
            of: String
        }
    },
    { timestamps: true }
);

// Index for faster queries
notificationSchema.index({ recipient: 1, status: 1, createdAt: -1 });
notificationSchema.index({ recipientRole: 1, createdAt: -1 });

export const Notification = mongoose.model("Notification", notificationSchema);
