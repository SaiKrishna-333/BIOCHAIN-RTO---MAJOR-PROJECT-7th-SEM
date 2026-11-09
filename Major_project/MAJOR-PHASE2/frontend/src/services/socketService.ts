import { io, Socket } from "socket.io-client";

const SOCKET_ORIGIN = import.meta.env.VITE_API_URL || "http://localhost:5000";

let socket: Socket | null = null;
let activeToken: string | null = null;

export const initializeSocket = (token: string) => {
  // React runs effects twice in development and the auth context re-runs on
  // every token change. Tearing down a socket that is still handshaking is what
  // makes the browser log "WebSocket is closed before the connection is
  // established", so an identical live connection is reused instead.
  if (socket && activeToken === token) return socket;
  if (socket) {
    socket.removeAllListeners();
    socket.close();
  }

  socket = io(SOCKET_ORIGIN, {
    auth: {
      token,
    },
    // Limited retries: a backend that is genuinely down stops logging instead of
    // hammering the socket endpoint forever.
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
    withCredentials: true,
  });

  socket.on("connect_error", (error: Error) => {
    console.warn("Live updates unavailable:", error.message);
  });

  activeToken = token;
  return socket;
};

export const getSocket = () => {
  if (!socket) {
    throw new Error("Socket not initialized. Call initializeSocket first.");
  }
  return socket;
};

export const joinRoom = (userId: string) => {
  if (socket) {
    socket.emit("join", userId);
  }
};

export const joinRoleRoom = (role: string) => {
  if (socket) {
    socket.emit("join-role", role);
  }
};

export const disconnectSocket = () => {
  if (socket) {
    socket.removeAllListeners();
    socket.close();
    socket = null;
    activeToken = null;
  }
};

export const onNotification = (callback: (data: unknown) => void) => {
  if (socket) {
    socket.on("notification", callback);
  }
};

export const onTheftAlert = (callback: (data: unknown) => void) => {
  if (socket) {
    socket.on("theft_alert", callback);
  }
};

export const onRequestApproved = (callback: (data: unknown) => void) => {
  if (socket) {
    socket.on("request_approved", callback);
  }
};

export const onRequestRejected = (callback: (data: unknown) => void) => {
  if (socket) {
    socket.on("request_rejected", callback);
  }
};

export const onNewRequest = (callback: (data: unknown) => void) => {
  if (socket) {
    socket.on("new_request", callback);
  }
};

export const offNotification = () => {
  if (socket) {
    socket.off("notification");
  }
};

export const offTheftAlert = () => {
  if (socket) {
    socket.off("theft_alert");
  }
};

export const offRequestApproved = () => {
  if (socket) {
    socket.off("request_approved");
  }
};

export const offRequestRejected = () => {
  if (socket) {
    socket.off("request_rejected");
  }
};

export const offNewRequest = () => {
  if (socket) {
    socket.off("new_request");
  }
};
