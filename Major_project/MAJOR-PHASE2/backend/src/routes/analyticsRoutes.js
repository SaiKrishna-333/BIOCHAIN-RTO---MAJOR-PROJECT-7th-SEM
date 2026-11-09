import express from "express";
import { authRequired, requireRole } from "../middleware/authMiddleware.js";
import { Vehicle } from "../models/Vehicle.js";
import { Request } from "../models/Request.js";
import { TheftReport } from "../models/TheftReport.js";
import { User } from "../models/User.js";

const router = express.Router();

// Get vehicle registration statistics
router.get("/registrations", authRequired, requireRole("rto", "police"), async (req, res) => {
    try {
        const { period = "monthly", year = new Date().getFullYear() } = req.query;

        const startDate = new Date(year, 0, 1);
        const endDate = new Date(year, 11, 31, 23, 59, 59);

        const matchStage = {
            createdAt: { $gte: startDate, $lte: endDate },
            status: "approved"
        };

        let groupStage;
        let sortStage;

        if (period === "monthly") {
            groupStage = {
                _id: { month: { $month: "$createdAt" } },
                count: { $sum: 1 }
            };
            sortStage = { "_id.month": 1 };
        } else if (period === "yearly") {
            groupStage = {
                _id: { year: { $year: "$createdAt" } },
                count: { $sum: 1 }
            };
            sortStage = { "_id.year": 1 };
        } else {
            return res.status(400).json({ message: "Invalid period. Use 'monthly' or 'yearly'" });
        }

        const registrations = await Request.aggregate([
            { $match: matchStage },
            { $group: groupStage },
            { $sort: sortStage }
        ]);

        // Format data for charts
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const formattedData = registrations.map(item => ({
            label: period === "monthly" ? monthNames[item._id.month - 1] : item._id.year.toString(),
            value: item.count,
            month: item._id.month,
            year: item._id.year
        }));

        // Fill in missing months with 0
        if (period === "monthly") {
            for (let i = 1; i <= 12; i++) {
                if (!formattedData.find(d => d.month === i)) {
                    formattedData.push({
                        label: monthNames[i - 1],
                        value: 0,
                        month: i,
                        year: parseInt(year)
                    });
                }
            }
            formattedData.sort((a, b) => a.month - b.month);
        }

        res.json({
            period,
            year: parseInt(year),
            data: formattedData,
            total: formattedData.reduce((sum, item) => sum + item.value, 0)
        });
    } catch (err) {
        console.error("Registration stats error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Get transfer volume analytics
router.get("/transfers", authRequired, requireRole("rto", "police"), async (req, res) => {
    try {
        const { period = "monthly", year = new Date().getFullYear() } = req.query;

        const startDate = new Date(year, 0, 1);
        const endDate = new Date(year, 11, 31, 23, 59, 59);

        const matchStage = {
            createdAt: { $gte: startDate, $lte: endDate },
            status: "approved",
            type: "transfer"
        };

        let groupStage;
        let sortStage;

        if (period === "monthly") {
            groupStage = {
                _id: { month: { $month: "$createdAt" } },
                count: { $sum: 1 }
            };
            sortStage = { "_id.month": 1 };
        } else {
            groupStage = {
                _id: { year: { $year: "$createdAt" } },
                count: { $sum: 1 }
            };
            sortStage = { "_id.year": 1 };
        }

        const transfers = await Request.aggregate([
            { $match: matchStage },
            { $group: groupStage },
            { $sort: sortStage }
        ]);

        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const formattedData = transfers.map(item => ({
            label: period === "monthly" ? monthNames[item._id.month - 1] : item._id.year.toString(),
            value: item.count,
            month: item._id.month,
            year: item._id.year
        }));

        if (period === "monthly") {
            for (let i = 1; i <= 12; i++) {
                if (!formattedData.find(d => d.month === i)) {
                    formattedData.push({
                        label: monthNames[i - 1],
                        value: 0,
                        month: i,
                        year: parseInt(year)
                    });
                }
            }
            formattedData.sort((a, b) => a.month - b.month);
        }

        res.json({
            period,
            year: parseInt(year),
            data: formattedData,
            total: formattedData.reduce((sum, item) => sum + item.value, 0)
        });
    } catch (err) {
        console.error("Transfer stats error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Get theft and recovery statistics
router.get("/theft-recovery", authRequired, requireRole("rto", "police"), async (req, res) => {
    try {
        const { year = new Date().getFullYear() } = req.query;

        const startDate = new Date(year, 0, 1);
        const endDate = new Date(year, 11, 31, 23, 59, 59);

        // Get theft reports by month
        const thefts = await TheftReport.aggregate([
            { $match: { createdAt: { $gte: startDate, $lte: endDate } } },
            {
                $group: {
                    _id: { month: { $month: "$createdAt" } },
                    reported: { $sum: 1 },
                    recovered: {
                        $sum: { $cond: [{ $eq: ["$status", "recovered"] }, 1, 0] }
                    }
                }
            },
            { $sort: { "_id.month": 1 } }
        ]);

        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const formattedData = [];

        for (let i = 1; i <= 12; i++) {
            const monthData = thefts.find(t => t._id.month === i);
            formattedData.push({
                label: monthNames[i - 1],
                reported: monthData ? monthData.reported : 0,
                recovered: monthData ? monthData.recovered : 0,
                month: i
            });
        }

        // Calculate totals
        const totalReported = formattedData.reduce((sum, item) => sum + item.reported, 0);
        const totalRecovered = formattedData.reduce((sum, item) => sum + item.recovered, 0);
        const recoveryRate = totalReported > 0 ? ((totalRecovered / totalReported) * 100).toFixed(1) : 0;

        // Get current status breakdown
        const statusBreakdown = await TheftReport.aggregate([
            { $match: { createdAt: { $gte: startDate, $lte: endDate } } },
            {
                $group: {
                    _id: "$status",
                    count: { $sum: 1 }
                }
            }
        ]);

        res.json({
            year: parseInt(year),
            monthlyData: formattedData,
            summary: {
                totalReported,
                totalRecovered,
                recoveryRate,
                pending: totalReported - totalRecovered
            },
            statusBreakdown: statusBreakdown.reduce((acc, item) => {
                acc[item._id] = item.count;
                return acc;
            }, {})
        });
    } catch (err) {
        console.error("Theft recovery stats error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Get RTO performance metrics
router.get("/rto-performance", authRequired, requireRole("rto"), async (req, res) => {
    try {
        const { year = new Date().getFullYear() } = req.query;

        const startDate = new Date(year, 0, 1);
        const endDate = new Date(year, 11, 31, 23, 59, 59);

        // Get all RTO officers
        const rtoOfficers = await User.find({ role: "rto" }).select("_id name email");

        const performanceData = [];

        for (const officer of rtoOfficers) {
            // Get requests processed by this officer
            const requests = await Request.find({
                rtoOfficer: officer._id,
                status: { $in: ["approved", "rejected"] },
                updatedAt: { $gte: startDate, $lte: endDate }
            });

            const approved = requests.filter(r => r.status === "approved").length;
            const rejected = requests.filter(r => r.status === "rejected").length;

            // Calculate average approval time (for approved requests)
            let totalApprovalTime = 0;
            let approvalCount = 0;

            for (const request of requests.filter(r => r.status === "approved")) {
                const created = new Date(request.createdAt);
                const updated = new Date(request.updatedAt);
                const diffHours = (updated.getTime() - created.getTime()) / (1000 * 60 * 60);
                totalApprovalTime += diffHours;
                approvalCount++;
            }

            const avgApprovalTime = approvalCount > 0 ? (totalApprovalTime / approvalCount).toFixed(1) : 0;

            // Get pending requests for this officer
            const pendingCount = await Request.countDocuments({
                rtoOfficer: officer._id,
                status: "pending"
            });

            performanceData.push({
                officerId: officer._id,
                name: officer.name,
                email: officer.email,
                approved,
                rejected,
                totalProcessed: approved + rejected,
                avgApprovalTime: parseFloat(avgApprovalTime),
                pendingRequests: pendingCount
            });
        }

        // Sort by total processed (descending)
        performanceData.sort((a, b) => b.totalProcessed - a.totalProcessed);

        // Get overall statistics
        const overallStats = {
            totalRequests: await Request.countDocuments({
                updatedAt: { $gte: startDate, $lte: endDate }
            }),
            totalApproved: await Request.countDocuments({
                status: "approved",
                updatedAt: { $gte: startDate, $lte: endDate }
            }),
            totalRejected: await Request.countDocuments({
                status: "rejected",
                updatedAt: { $gte: startDate, $lte: endDate }
            }),
            totalPending: await Request.countDocuments({ status: "pending" })
        };

        res.json({
            year: parseInt(year),
            officers: performanceData,
            overall: overallStats
        });
    } catch (err) {
        console.error("RTO performance stats error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Get vehicle status distribution
router.get("/vehicle-status", authRequired, requireRole("rto", "police"), async (req, res) => {
    try {
        const statusDistribution = await Vehicle.aggregate([
            {
                $group: {
                    _id: "$status",
                    count: { $sum: 1 }
                }
            }
        ]);

        const total = statusDistribution.reduce((sum, item) => sum + item.count, 0);

        const formattedData = statusDistribution.map(item => ({
            status: item._id,
            count: item.count,
            percentage: ((item.count / total) * 100).toFixed(1)
        }));

        res.json({
            total,
            distribution: formattedData
        });
    } catch (err) {
        console.error("Vehicle status stats error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Get overview statistics
router.get("/overview", authRequired, requireRole("rto", "police"), async (req, res) => {
    try {
        const totalVehicles = await Vehicle.countDocuments();
        const totalOwners = await User.countDocuments({ role: "owner" });
        const totalDealers = await User.countDocuments({ role: "dealer" });
        const totalRequests = await Request.countDocuments();
        const pendingRequests = await Request.countDocuments({ status: "pending" });
        const totalTheftReports = await TheftReport.countDocuments();
        const activeTheftCases = await TheftReport.countDocuments({
            status: { $in: ["reported", "under_investigation"] }
        });

        // Get recent activity (last 30 days)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const recentRegistrations = await Request.countDocuments({
            type: "newRegistration",
            status: "approved",
            createdAt: { $gte: thirtyDaysAgo }
        });

        const recentTransfers = await Request.countDocuments({
            type: "transfer",
            status: "approved",
            createdAt: { $gte: thirtyDaysAgo }
        });

        res.json({
            counts: {
                totalVehicles,
                totalOwners,
                totalDealers,
                totalRequests,
                pendingRequests,
                totalTheftReports,
                activeTheftCases
            },
            recentActivity: {
                registrations: recentRegistrations,
                transfers: recentTransfers
            }
        });
    } catch (err) {
        console.error("Overview stats error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Public registry pulse for the landing page.
// Aggregate counts only - no plate, owner name, document or address is returned
// here, which is why this is the one analytics route that needs no sign-in. The
// landing page shows these figures instead of the illustrative numbers it used
// to carry, so everything a visitor reads about the registry is true of it.
router.get("/registry-pulse", async (req, res) => {
    try {
        const [totalVehicles, onChainVehicles, totalOwners, pendingRequests,
            registrationsCompleted, transfersCompleted, theftCasesActive, vehiclesBlocked]
            = await Promise.all([
                Vehicle.countDocuments(),
                Vehicle.countDocuments({ blockchainTxHash: { $nin: [null, ""] } }),
                User.countDocuments({ role: "owner" }),
                Request.countDocuments({ status: "pending" }),
                Request.countDocuments({ type: "newRegistration", status: "approved" }),
                Request.countDocuments({ type: "transfer", status: "approved" }),
                TheftReport.countDocuments({ status: { $in: ["reported", "under_investigation"] } }),
                Vehicle.countDocuments({ status: { $in: ["stolen", "blocked"] } }),
            ]);

        res.json({
            totalVehicles,
            onChainVehicles,
            totalOwners,
            pendingRequests,
            registrationsCompleted,
            transfersCompleted,
            theftCasesActive,
            vehiclesBlocked,
            // Stated explicitly because the records are committed on a test network.
            chainNetwork: "Polygon Amoy testnet",
            asOf: new Date().toISOString(),
        });
    } catch (err) {
        console.error("Registry pulse error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

export default router;
