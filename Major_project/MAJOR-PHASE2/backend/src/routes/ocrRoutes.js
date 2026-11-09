// ocrRoutes.js
// Public sign-up-time document OCR: upload a government ID image, get the
// registration form fields back pre-extracted. No auth (used before login),
// image never persisted, only parsed fields returned to the same browser.

import express from "express";
import multer from "multer";
import { extractIdentityFromImage } from "../services/ocrService.js";

const router = express.Router();

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024 }, // OCR of a photo needs a bit more headroom
});

router.post("/extract", upload.single("document"), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: "No document image received." });
    }
    if (!/^image\/(jpeg|png|webp|bmp|gif)$/.test(req.file.mimetype)) {
        return res.status(400).json({ message: "Only image files (JPG/PNG/WEBP/BMP) can be OCR-read. For a PDF, take a screenshot of the page and upload that." });
    }
    try {
        const result = await extractIdentityFromImage(req.file.buffer);
        res.json({
            success: true,
            documentType: result.documentType,
            fields: result.fields,
            confidence: result.confidence,
            rawTextPreview: result.rawTextPreview,
            message: result.message,
        });
    } catch (err) {
        console.error("OCR extract error:", err.message);
        // Honest degradation - OCR is an accelerator, never a blocker.
        res.status(200).json({
            success: false,
            documentType: "unknown",
            fields: {},
            confidence: 0,
            message: `OCR could not read this document (${err.message}). You can still type the details manually.`,
        });
    }
});

export default router;
