import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/useAuth";
import {
  onNotification,
  onTheftAlert,
  onRequestApproved,
  onRequestRejected,
  onNewRequest,
  offNotification,
  offTheftAlert,
  offRequestApproved,
  offRequestRejected,
  offNewRequest,
} from "../services/socketService";
import { formatDateTime } from "../lib/display";

interface Notification {
  id: string;
  dbId?: string;
  type: string;
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  actionUrl?: string | null;
}

export default function NotificationBell() {
  const { user, api } = useAuth();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  // Load persisted notifications (the intel-request / resale-offer workflow
  // stores records here) so the bell shows the full history, not just live pushes.
  const loadNotifications = useCallback(async () => {
    try {
      const res = await api.get("/notifications?limit=30");
      const list: Notification[] = (res.data.notifications || []).map(
        (n: {
          _id: string;
          type: string;
          title: string;
          message: string;
          createdAt: string;
          status: string;
          actionUrl?: string;
        }) => ({
          id: n._id,
          dbId: n._id,
          type: n.type,
          title: n.title,
          message: n.message,
          timestamp: n.createdAt,
          read: n.status === "read",
          actionUrl: n.actionUrl || null,
        }),
      );
      setNotifications(list);
      setUnreadCount(list.filter((n) => !n.read).length);
    } catch {
      /* offline - live pushes still work */
    }
  }, [api]);

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      await loadNotifications();
    };
    load();
  }, [user, loadNotifications]);

  useEffect(() => {
    if (!user) return;

    const handleNotification = (data: unknown) => {
      const notificationData = data as {
        type?: string;
        title?: string;
        message?: string;
        timestamp?: string;
        actionUrl?: string | null;
        notificationId?: string;
      };
      const newNotification: Notification = {
        id: notificationData.notificationId || Date.now().toString(),
        dbId: notificationData.notificationId,
        type: notificationData.type || "info",
        title: notificationData.title || "Notification",
        message: notificationData.message || "",
        timestamp: notificationData.timestamp || new Date().toISOString(),
        read: false,
        actionUrl: notificationData.actionUrl || null,
      };
      setNotifications((prev) => [newNotification, ...prev]);
      setUnreadCount((prev) => prev + 1);
    };

    const handleTheftAlert = (data: unknown) => {
      const alertData = data as {
        title?: string;
        message?: string;
        timestamp?: string;
      };
      const newNotification: Notification = {
        id: Date.now().toString(),
        type: "theft_alert",
        title: alertData.title || "THEFT ALERT",
        message: alertData.message || "",
        timestamp: alertData.timestamp || new Date().toISOString(),
        read: false,
      };
      setNotifications((prev) => [newNotification, ...prev]);
      setUnreadCount((prev) => prev + 1);
    };

    const handleRequestApproved = (data: unknown) => {
      const approvalData = data as {
        message?: string;
        timestamp?: string;
      };
      const newNotification: Notification = {
        id: Date.now().toString(),
        type: "approval",
        title: "Request Approved",
        message: approvalData.message || "Your request has been approved",
        timestamp: approvalData.timestamp || new Date().toISOString(),
        read: false,
      };
      setNotifications((prev) => [newNotification, ...prev]);
      setUnreadCount((prev) => prev + 1);
    };

    const handleRequestRejected = (data: unknown) => {
      const rejectionData = data as {
        message?: string;
        timestamp?: string;
      };
      const newNotification: Notification = {
        id: Date.now().toString(),
        type: "rejection",
        title: "Request Rejected",
        message: rejectionData.message || "Your request has been rejected",
        timestamp: rejectionData.timestamp || new Date().toISOString(),
        read: false,
      };
      setNotifications((prev) => [newNotification, ...prev]);
      setUnreadCount((prev) => prev + 1);
    };

    const handleNewRequest = (data: unknown) => {
      const requestData = data as {
        message?: string;
        timestamp?: string;
      };
      const newNotification: Notification = {
        id: Date.now().toString(),
        type: "new_request",
        title: "New Request",
        message: requestData.message || "A new request has been received",
        timestamp: requestData.timestamp || new Date().toISOString(),
        read: false,
      };
      setNotifications((prev) => [newNotification, ...prev]);
      setUnreadCount((prev) => prev + 1);
    };

    // Subscribe to all notification types
    onNotification(handleNotification);
    onTheftAlert(handleTheftAlert);
    onRequestApproved(handleRequestApproved);
    onRequestRejected(handleRequestRejected);
    onNewRequest(handleNewRequest);

    return () => {
      // Unsubscribe when component unmounts
      offNotification();
      offTheftAlert();
      offRequestApproved();
      offRequestRejected();
      offNewRequest();
    };
  }, [user]);

  const markAllAsRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
    api.put("/notifications/read-all").catch(() => {});
  };

  const handleItemClick = (notification: Notification) => {
    if (!notification.read) {
      setNotifications((prev) =>
        prev.map((n) => (n.id === notification.id ? { ...n, read: true } : n)),
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
      if (notification.dbId) {
        api.put(`/notifications/${notification.dbId}/read`).catch(() => {});
      }
    }
    if (notification.actionUrl) {
      setShowDropdown(false);
      navigate(notification.actionUrl);
    }
  };

  // Formal status dot colour per notification type (no decorative icons)
  const getTypeDot = (type: string) => {
    switch (type) {
      case "theft_alert":
      case "rejection":
      case "request-rejected":
        return "var(--color-danger)";
      case "approval":
      case "transfer-approved":
      case "registration-approved":
      case "intel-response":
        return "var(--color-success)";
      case "transfer-offer":
      case "intel-request":
      case "new_request":
        return "var(--color-cyan)";
      default:
        return "var(--color-text-muted)";
    }
  };

  if (!user) return null;

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        aria-label="Notifications"
        style={{
          background: "var(--color-bg-secondary)",
          border: "1px solid var(--color-border-light)",
          cursor: "pointer",
          fontSize: "13px",
          fontWeight: 600,
          letterSpacing: "0.3px",
          textTransform: "uppercase",
          color: "var(--color-text-primary)",
          position: "relative",
          padding: "8px 14px",
          borderRadius: 6,
        }}
      >
        Notifications
        {unreadCount > 0 && (
          <span
            style={{
              position: "absolute",
              top: "0",
              right: "0",
              background: "var(--color-danger)",
              color: "white",
              borderRadius: "50%",
              width: "18px",
              height: "18px",
              fontSize: "12px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {showDropdown && (
        <div
          style={{
            position: "absolute",
            right: "0",
            top: "100%",
            width: "350px",
            maxHeight: "400px",
            overflow: "auto",
            background: "var(--color-bg-card)",
            border: "1px solid var(--color-border-light)",
            borderRadius: "8px",
            boxShadow: "0 8px 24px rgba(15, 40, 80, 0.18)",
            zIndex: 1200,
            color: "var(--color-text-primary)",
          }}
        >
          <div
            style={{
              padding: "12px 16px",
              borderBottom: "1px solid var(--color-border)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <h4 style={{ margin: 0 }}>Notifications</h4>
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--color-cyan)",
                  cursor: "pointer",
                  fontSize: "12px",
                }}
              >
                Mark all as read
              </button>
            )}
          </div>

          {notifications.length === 0 ? (
            <div
              style={{
                padding: "20px",
                textAlign: "center",
                color: "var(--color-text-secondary)",
              }}
            >
              No notifications
            </div>
          ) : (
            notifications.map((notification) => (
              <div
                key={notification.id}
                onClick={() => handleItemClick(notification)}
                style={{
                  padding: "12px 16px",
                  borderBottom: "1px solid var(--color-border)",
                  background: notification.read
                    ? "transparent"
                    : "rgba(30, 90, 168, 0.08)",
                  display: "flex",
                  gap: "12px",
                  alignItems: "flex-start",
                  cursor: notification.actionUrl ? "pointer" : "default",
                }}
              >
                <span
                  style={{
                    width: "10px",
                    height: "10px",
                    borderRadius: "50%",
                    background: getTypeDot(notification.type),
                    marginTop: "5px",
                    flexShrink: 0,
                  }}
                />
                <div style={{ flex: 1 }}>
                  <p
                    style={{
                      margin: "0 0 4px 0",
                      fontWeight: notification.read ? "normal" : "bold",
                      fontSize: "14px",
                    }}
                  >
                    {notification.title}
                  </p>
                  <p
                    style={{
                      margin: "0 0 4px 0",
                      fontSize: "13px",
                      color: "var(--color-text-secondary)",
                    }}
                  >
                    {notification.message}
                  </p>
                  <p
                    style={{
                      margin: "0 0 4px 0",
                      fontSize: "11px",
                      color: "var(--color-text-muted)",
                    }}
                  >
                    {formatDateTime(notification.timestamp)}
                  </p>
                  {notification.actionUrl && (
                    <p
                      style={{
                        margin: "4px 0 0 0",
                        fontSize: "12px",
                        color: "var(--color-cyan)",
                        fontWeight: 600,
                      }}
                    >
                      Open
                    </p>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
