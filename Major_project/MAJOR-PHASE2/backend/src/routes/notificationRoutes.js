import express from "express";
import { authRequired } from "../middleware/authMiddleware.js";
import {
    getUnreadNotifications,
    markAsRead,
    getNotificationCount
} from "../services/notificationService.js";
import { Notification } from "../models/Notification.js";

const router = express.Router();

// Get all notifications for the current user
router.get("/", authRequired, async (req, res) => {
    try {
        const { status = "all", page = 1, limit = 20 } = req.query;

        let query = { recipient: req.user.id };
        if (status !== "all") {
            query.status = status;
        }

        const notifications = await Notification.find(query)
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(parseInt(limit))
            .populate("relatedVehicle", "regNumber make model");

        const total = await Notification.countDocuments(query);

        res.json({
            notifications,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / limit)
            }
        });
    } catch (err) {
        console.error("get notifications error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Get unread notifications
router.get("/unread", authRequired, async (req, res) => {
    try {
        const { limit = 20 } = req.query;
        const notifications = await getUnreadNotifications(req.user.id, parseInt(limit));
        res.json(notifications);
    } catch (err) {
        console.error("get unread notifications error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Get notification count
router.get("/count", authRequired, async (req, res) => {
    try {
        const counts = await getNotificationCount(req.user.id);
        res.json(counts);
    } catch (err) {
        console.error("get notification count error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Mark notification as read
router.put("/:id/read", authRequired, async (req, res) => {
    try {
        const { id } = req.params;

        // Verify the notification belongs to the current user
        const notification = await Notification.findOne({
            _id: id,
            recipient: req.user.id
        });

        if (!notification) {
            return res.status(404).json({ message: "Notification not found" });
        }

        const updated = await markAsRead(id);
        res.json({ message: "Notification marked as read", notification: updated });
    } catch (err) {
        console.error("mark as read error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Mark all notifications as read
router.put("/read-all", authRequired, async (req, res) => {
    try {
        await Notification.updateMany(
            { recipient: req.user.id, status: "unread" },
            { status: "read" }
        );

        res.json({ message: "All notifications marked as read" });
    } catch (err) {
        console.error("mark all as read error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Delete a notification
router.delete("/:id", authRequired, async (req, res) => {
    try {
        const { id } = req.params;

        const notification = await Notification.findOneAndDelete({
            _id: id,
            recipient: req.user.id
        });

        if (!notification) {
            return res.status(404).json({ message: "Notification not found" });
        }

        res.json({ message: "Notification deleted" });
    } catch (err) {
        console.error("delete notification error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

export default router;
