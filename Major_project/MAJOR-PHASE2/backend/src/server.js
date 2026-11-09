import dotenv from "dotenv";
// quiet: the startup log should carry this application's messages only
dotenv.config({ quiet: true });

import { createServer } from "http";
import { connectDB } from "./config/db.js";
import app from "./app.js";
import { initializeSocket } from "./services/socketService.js";

const PORT = process.env.PORT || 5000;

// Resilience: async noise from background tasks (e.g. ethers RPC retries while a
// blockchain call is pending) must never kill the API server. Log and keep serving;
// the DB remains the authoritative store and each route already handles its own errors.
process.on("unhandledRejection", (reason) => {
    console.error("[server] Unhandled promise rejection (kept alive):", reason?.message || reason);
});
process.on("uncaughtException", (err) => {
    console.error("[server] Uncaught exception (logged, review recommended):", err);
});

const startServer = async () => {
    await connectDB();

    // Create HTTP server
    const httpServer = createServer(app);

    // Initialize Socket.IO
    initializeSocket(httpServer);

    httpServer.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
        console.log(`WebSocket server ready for real-time notifications`);
    });
};

startServer();
