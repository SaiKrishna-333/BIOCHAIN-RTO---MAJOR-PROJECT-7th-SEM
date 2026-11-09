// backfill-registration-facts.js
//
// A printed registration certificate is allowed to state three things it could
// not state before: the date the number was issued, the office that issued it
// and the officer who signed it. New approvals record all three as they happen.
// Vehicles that were issued earlier already carry the same facts inside their
// own approved request, so this pass reads them from there. It never invents a
// date, an office or an officer: where no request names one, the vehicle is
// reported and its certificate continues to say "Not recorded".
//
// Run: node src/backfill-registration-facts.js --dry-run   (report only)
//      node src/backfill-registration-facts.js             (apply)
//
// A second pass corrects invoices: an earlier build wrote "Paid" the moment a
// dealer raised an invoice, although nothing in this application receives
// payment for one. Those invoices are set back to "Pending" so the printed
// document states what the records actually show.
//
// A third pass settles how a state is stored. Accounts were created before one
// rule was chosen, so `user.state` holds either the two-letter code ("KA") or
// the full name ("Karnataka"). Downloads and cross-state filters read the code,
// so every value that maps to one of the supported states is rewritten as its
// code. Anything outside the supported set is left untouched and reported.

import "dotenv/config";
import mongoose from "mongoose";
import { Vehicle } from "./models/Vehicle.js";
import { Request } from "./models/Request.js";
import { User } from "./models/User.js";
import { STATE_RTO_CODES } from "./services/crossStateInteroperability.js";

const DRY_RUN = process.argv.includes("--dry-run");
const uri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/BioChainRTO";

// Resolve a stored state (code or full name) to its canonical two-letter code.
// Returns null when the value matches none of the supported states.
const NAME_BY_CODE = STATE_RTO_CODES;
const toStateCode = (value) => {
    const raw = String(value || "").trim();
    if (!raw) return null;
    const upper = raw.toUpperCase();
    if (NAME_BY_CODE[upper]) return upper;
    const match = Object.entries(NAME_BY_CODE)
        .find(([, name]) => name.toUpperCase() === upper);
    return match ? match[0] : null;
};

// "Name (employee id)" is the form the approval routes write, so backfilled
// records match the ones captured live.
const officerLine = (user) =>
    user ? `${user.name}${user.employeeId ? ` (${user.employeeId})` : ""}` : null;

const run = async () => {
    await mongoose.connect(uri);
    console.log(`Database: ${mongoose.connection.db.databaseName}${DRY_RUN ? " (dry run - nothing will be written)" : ""}`);

    const pending = await Vehicle.find({
        regNumber: { $nin: [null, ""] },
        $or: [{ registrationDate: null }, { registrationDate: { $exists: false } }],
    }).sort({ createdAt: 1 });

    console.log(`\n=== ${pending.length} registered vehicle(s) predate the certificate fields ===`);

    let filled = 0;
    let unprovable = 0;

    for (const vehicle of pending) {
        // Prefer the request that actually finished this vehicle's registration.
        const request = await Request.findOne({ vehicle: vehicle._id, status: "approved" })
            .sort({ updatedAt: -1 })
            .lean();

        let issueDate = request?.updatedAt || null;
        let office = null;
        let officer = null;

        const interState = request?.interStateDetails;
        if (interState?.destinationRTOApproval?.timestamp) {
            issueDate = interState.destinationRTOApproval.timestamp;
            office = interState.destinationRTOApproval.rtoOffice || null;
            officer = interState.destinationRTOApproval.officerName || null;
        } else if (request?.rtoOfficer) {
            const user = await User.findById(request.rtoOfficer).select("name employeeId rtoDetails").lean();
            office = user?.rtoDetails?.rtoOfficeName || null;
            officer = officerLine(user);
        }

        // An ownership record is also evidence of when the vehicle changed hands.
        if (!issueDate && vehicle.ownershipHistory?.length) {
            issueDate = vehicle.ownershipHistory[0].transferDate || null;
        }

        if (!issueDate) {
            unprovable++;
            console.log(`  ${vehicle.regNumber}: no approved request and no ownership date on record - left as "Not recorded"`);
            continue;
        }

        vehicle.registrationDate = issueDate;
        if (office && !vehicle.issuedByOffice) vehicle.issuedByOffice = office;
        if (officer && !vehicle.issuedByOfficer) vehicle.issuedByOfficer = officer;
        filled++;

        console.log(`  ${vehicle.regNumber}: issued ${vehicle.registrationDate.toISOString().slice(0, 10)}` +
            `${vehicle.issuedByOffice ? ` at ${vehicle.issuedByOffice}` : ""}` +
            `${vehicle.issuedByOfficer ? `, officer ${vehicle.issuedByOfficer}` : ""}`);

        // Targeted $set, never a whole-document save: a document read here may
        // not carry every field, and saving it could clear fields this pass is
        // not meant to touch.
        if (!DRY_RUN) {
            await Vehicle.updateOne({ _id: vehicle._id }, {
                $set: {
                    registrationDate: vehicle.registrationDate,
                    issuedByOffice: vehicle.issuedByOffice || null,
                    issuedByOfficer: vehicle.issuedByOfficer || null,
                }
            });
        }
    }

    console.log(`\n${DRY_RUN ? "Would fill" : "Filled"}: ${filled}, left as not recorded: ${unprovable}.`);

    // Invoices that claim a payment no receipt ever confirmed.
    const paidInvoices = await Request.find({
        type: "newRegistration",
        "invoice.paymentStatus": "Paid",
    }).select("invoice");

    console.log(`\n=== ${paidInvoices.length} invoice(s) state "Paid" with no payment recorded ===`);
    for (const request of paidInvoices) {
        console.log(`  ${request.invoice?.invoiceNumber || request._id}: set to Pending`);
        if (!DRY_RUN) {
            await Request.updateOne({ _id: request._id }, { $set: { "invoice.paymentStatus": "Pending" } });
        }
    }
    if (!paidInvoices.length) console.log("  None - every invoice already states its payment position honestly.");

    // States stored as a full name instead of the code the workflows read.
    const users = await User.find({}).select("state name role rtoDetails");
    console.log("\n=== normalising user.state to the supported two-letter codes ===");
    let normalised = 0;
    let outsideSet = 0;
    for (const user of users) {
        const setFields = {};

        const code = toStateCode(user.state);
        if (user.state && !code) {
            outsideSet++;
            console.log(`  ${user.role || "user"} ${user.name}: "${user.state}" is not a supported state - left as recorded`);
        } else if (code && code !== user.state) {
            setFields.state = code;
        }

        if (user.rtoDetails?.stateCode) {
            const rtoCode = toStateCode(user.rtoDetails.stateCode);
            if (rtoCode && rtoCode !== user.rtoDetails.stateCode) {
                setFields["rtoDetails.stateCode"] = rtoCode;
                if (user.rtoDetails.stateName) setFields["rtoDetails.stateName"] = NAME_BY_CODE[rtoCode];
            }
        }

        if (Object.keys(setFields).length) {
            normalised++;
            console.log(`  ${user.role || "user"} ${user.name}: ${Object.entries(setFields).map(([k, v]) => `${k} -> ${v}`).join(", ")}`);
            // $set of only the changed paths - this document was read with a
            // field selection, so a full save would unset the fields it lacks
            // (a previous version of this pass cleared Aadhaar and licence
            // numbers this way).
            if (!DRY_RUN) await User.updateOne({ _id: user._id }, { $set: setFields });
        }
    }
    console.log(`\n${DRY_RUN ? "Would normalise" : "Normalised"}: ${normalised} user record(s); outside the supported set: ${outsideSet}.`);

    await mongoose.disconnect();
};

run().catch((err) => {
    console.error("Backfill failed:", err.message);
    process.exit(1);
});
