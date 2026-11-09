import express from "express";
import cors from "cors";
import morgan from "morgan";
import mongoose from "mongoose";

import authRoutes from "./routes/authRoutes.js";
import vehicleRoutes from "./routes/vehicleRoutes.js";
import requestRoutes from "./routes/requestRoutes.js";
import policeRoutes from "./routes/policeRoutes.js";
import documentRoutes from "./routes/documentRoutes.js";
import documentManagementRoutes from "./routes/documentManagementRoutes.js";
import theftRoutes from "./routes/theftRoutes.js";
import inheritanceRoutes from "./routes/inheritanceRoutes.js";
import verificationRoutes from "./routes/verificationRoutes.js";
import notificationRoutes from "./routes/notificationRoutes.js";
import didRoutes from "./routes/didRoutes.js";
import uploadRoutes from "./routes/uploadRoutes.js";
import analyticsRoutes from "./routes/analyticsRoutes.js";
import challanRoutes from "./routes/challanRoutes.js";
import patentFeaturesRoutes from "./routes/patentFeaturesRoutes.js";
import interStateTransferRoutes from "./routes/interStateTransferRoutes.js";
import migrationRoutes from "./routes/migrationRoutes.js";
import vehicleIntelligenceRoutes from "./routes/vehicleIntelligenceRoutes.js";
import investigationRoutes from "./routes/investigationRoutes.js";
import transferApprovalRoutes from "./routes/transferApprovalRoutes.js";
import ocrRoutes from "./routes/ocrRoutes.js";
import idCardRoutes from "./routes/idCardRoutes.js";
import forensicsRoutes from "./routes/forensicsRoutes.js";
import damageRoutes from "./routes/damageRoutes.js";

const app = express();

app.use(cors());
app.use(express.json());
// Every request is logged once, in morgan's own format - a second hand-rolled
// logger only duplicated each line.
app.use(morgan("dev"));

app.use("/api/auth", authRoutes);
app.use("/api/vehicles", vehicleRoutes);
app.use("/api/requests", requestRoutes);
app.use("/api/police", policeRoutes);
app.use("/api/documents", documentRoutes);
app.use("/api/documents-mgmt", documentManagementRoutes);
app.use("/api/theft", theftRoutes);
app.use("/api/inheritance", inheritanceRoutes);
app.use("/api/verification", verificationRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/did", didRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/challans", challanRoutes);
app.use("/api/patent-features", patentFeaturesRoutes);
app.use("/api/inter-state", interStateTransferRoutes);
app.use("/api/migration", migrationRoutes);
app.use("/api/vehicle-intelligence", vehicleIntelligenceRoutes);
app.use("/api/investigations", investigationRoutes);
app.use("/api/transfer-approvals", transferApprovalRoutes);
app.use("/api/ocr", ocrRoutes);
app.use("/api/id-card", idCardRoutes);
app.use("/api/forensics", forensicsRoutes);
app.use("/api/damage", damageRoutes);

app.get("/", (req, res) => {
    res.json({ message: "BioChain RTO API is running" });
});

// One endpoint a reviewer or a deployment health check can ping: what the API
// can actually prove about itself right now, and nothing more.
app.get("/api/health", (req, res) => {
    const connected = mongoose.connection.readyState === 1;
    res.status(connected ? 200 : 503).json({
        status: connected ? "ok" : "degraded",
        service: "BioChain RTO API",
        uptimeSeconds: Math.round(process.uptime()),
        database: connected ? "connected" : "not connected",
        chainNetwork: process.env.CHAIN_NETWORK || "polygon-amoy",
        chainConfigured: !!process.env.CONTRACT_ADDRESS,
    });
});

// Anything still unmatched is an unknown endpoint: answer in JSON, because every
// caller of /api is a JSON client and Express' HTML 404 page tells them nothing.
app.use((req, res) => {
    res.status(404).json({ message: `No API route matches ${req.method} ${req.path}` });
});

// Last line of defence. A rejected upload or a broken token is reported with the
// reason the caller can act on, and the stack stays in the server log.
app.use((err, req, res, next) => {
    console.error(`Unhandled error on ${req.method} ${req.path}: ${err.message}`);
    if (res.headersSent) return next(err);

    // multer signals oversized or malformed uploads through err.code; those are
    // the client's to fix, so they are not reported as a server fault.
    const clientFault = !!err.code || !!err.status;
    const messages = {
        LIMIT_FILE_SIZE: "The file is larger than the 10 MB this API accepts.",
        LIMIT_FILE_COUNT: "Too many files in one request.",
        LIMIT_UNEXPECTED_FILE: "Unexpected file field in the upload.",
    };
    const status = err.code === "LIMIT_FILE_SIZE" ? 413 : clientFault ? (err.status || 400) : 500;
    res.status(status).json({
        message: messages[err.code] || (status === 500 ? "Server error" : err.message),
    });
});

export default app;