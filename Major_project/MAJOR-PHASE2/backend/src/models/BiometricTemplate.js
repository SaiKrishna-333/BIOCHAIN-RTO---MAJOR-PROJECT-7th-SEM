import mongoose from "mongoose";

// biometricService used to keep templates in a JavaScript Map, which meant every
// restart silently un-enrolled the whole system: a transfer or an accident-evidence
// re-check would come back with "No enrolled fingerprint found" for a user whose
// fingerprintTemplateId was still on their account. The template itself stays a
// simulation (see BIOMETRIC_SIMULATION_GUIDE.md), but the enrolment record is now
// durable so the control survives a restart.
const biometricTemplateSchema = new mongoose.Schema(
    {
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        templateId: { type: String, required: true, unique: true },
        // The captured sample, or the placeholder used when the app enrols without
        // hardware. Never a plain Aadhaar/biometric original - this is a template id
        // store, not a biometric database.
        template: { type: String },
        status: { type: String, enum: ["active", "revoked"], default: "active" },
        enrolledAt: { type: Date, default: Date.now }
    },
    { timestamps: true }
);

// Verification looks a user's active template up by owner, enrolment writes by id.
biometricTemplateSchema.index({ user: 1, status: 1 });

export const BiometricTemplate = mongoose.model("BiometricTemplate", biometricTemplateSchema);
