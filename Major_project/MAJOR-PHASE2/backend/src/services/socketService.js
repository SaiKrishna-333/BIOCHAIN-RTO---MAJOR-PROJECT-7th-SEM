// socketService.js
// WebSocket service for real-time notifications

import { Server } from "socket.io";

let io = null;

/**
 * Initialize Socket.IO server
 * @param {http.Server} httpServer - HTTP server instance
 */
export const initializeSocket = (httpServer) => {
    io = new Server(httpServer, {
        cors: {
            origin: ["http://localhost:5173", "http://localhost:5174", "http://localhost:5175"],
            methods: ["GET", "POST"],
            credentials: true
        }
    });

    io.on("connection", (socket) => {
        // Join user-specific room
        socket.on("join", (userId) => {
            socket.join(`user:${userId}`);
        });

        // Join role-specific room
        socket.on("join-role", (role) => {
            socket.join(`role:${role}`);
        });
    });

    console.log("Socket.IO initialized");
    return io;
};

/**
 * Get IO instance
 */
export const getIO = () => {
    if (!io) {
        throw new Error("Socket.IO not initialized");
    }
    return io;
};

/**
 * Send notification to specific user
 * @param {string} userId - User ID
 * @param {string} event - Event name
 * @param {Object} data - Notification data
 */
export const emitToUser = (userId, event, data) => {
    if (!io) return;

    io.to(`user:${userId}`).emit(event, {
        ...data,
        timestamp: new Date().toISOString()
    });
};

/**
 * Send notification to all users with a role
 * @param {string} role - User role
 * @param {string} event - Event name
 * @param {Object} data - Notification data
 */
export const emitToRole = (role, event, data) => {
    if (!io) return;

    io.to(`role:${role}`).emit(event, {
        ...data,
        timestamp: new Date().toISOString()
    });
};

/**
 * Send theft alert to all RTO and Police
 * @param {Object} vehicle - Vehicle data
 * @param {Object} theftReport - Theft report data
 */
export const emitTheftAlert = (vehicle, theftReport) => {
    if (!io) return;

    const alertData = {
        type: "theft_alert",
        priority: "critical",
        title: `THEFT ALERT: ${vehicle.regNumber}`,
        message: `Vehicle ${vehicle.regNumber} (${vehicle.make} ${vehicle.model}) reported stolen`,
        vehicle: {
            regNumber: vehicle.regNumber,
            make: vehicle.make,
            model: vehicle.model,
            year: vehicle.year
        },
        theftReport: {
            firNumber: theftReport.firNumber,
            policeStation: theftReport.policeStation,
            incidentLocation: theftReport.incidentLocation
        }
    };

    // Send to all RTO officers
    emitToRole("rto", "theft_alert", alertData);

    // Send to all police officers
    emitToRole("police", "theft_alert", alertData);

    console.log(`Theft alert emitted for ${vehicle.regNumber}`);
};

/**
 * Send notification to specific user
 * @param {string} userId - User ID
 * @param {Object} notification - Notification object
 */
export const emitNotification = (userId, notification) => {
    emitToUser(userId, "notification", notification);
};

/**
 * Broadcast to all connected clients
 * @param {string} event - Event name
 * @param {Object} data - Data to broadcast
 */
export const broadcast = (event, data) => {
    if (!io) return;

    io.emit(event, {
        ...data,
        timestamp: new Date().toISOString()
    });
};

/**
 * Send approval notification
 * @param {string} userId - User ID
 * @param {Object} request - Request data
 * @param {Object} vehicle - Vehicle data
 */
export const emitApproval = (userId, request, vehicle) => {
    emitToUser(userId, "request_approved", {
        type: "approval",
        requestId: request._id,
        requestType: request.type,
        vehicle: {
            regNumber: vehicle.regNumber,
            make: vehicle.make,
            model: vehicle.model
        },
        message: `Your ${request.type} request has been approved`
    });
};

/**
 * Send rejection notification
 * @param {string} userId - User ID
 * @param {Object} request - Request data
 * @param {string} remarks - Rejection reason
 */
export const emitRejection = (userId, request, remarks) => {
    emitToUser(userId, "request_rejected", {
        type: "rejection",
        requestId: request._id,
        requestType: request.type,
        remarks,
        message: `Your ${request.type} request has been rejected`
    });
};

/**
 * Send new request notification to RTO
 * @param {Object} request - Request data
 * @param {Object} vehicle - Vehicle data
 */
export const emitNewRequest = (request, vehicle) => {
    emitToRole("rto", "new_request", {
        type: "new_request",
        requestId: request._id,
        requestType: request.type,
        vehicle: {
            regNumber: vehicle.regNumber,
            make: vehicle.make,
            model: vehicle.model
        },
        message: `New ${request.type} request received`
    });
};
