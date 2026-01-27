// backend/Controllers/UploadFile.js - R2 Upload + long cache headers
import express from "express";
import multer from "multer";
import { randomUUID } from "crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { r2 } from "../config/r2Client.js";
import dotenv from "dotenv";
dotenv.config();

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
});

const { R2_BUCKET_NAME, R2_PUBLIC_BASE_URL } = process.env;

const MIME_TO_EXT = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/gif": "gif",
  "image/svg+xml": "svg",
};

router.post("/", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded",
      });
    }

    if (!R2_BUCKET_NAME || !R2_PUBLIC_BASE_URL) {
      console.error("R2 config missing:", { R2_BUCKET_NAME, R2_PUBLIC_BASE_URL });
      return res.status(500).json({
        success: false,
        message: "R2 configuration missing",
      });
    }

    const mime = String(req.file.mimetype || "");

    // Keep this strict for safety (Uploader is used for images everywhere in your UI)
    if (!mime.startsWith("image/")) {
      return res.status(400).json({
        success: false,
        message: `Unsupported file type: ${mime}. Only images are allowed.`,
      });
    }

    const extFromMime = MIME_TO_EXT[mime];
    const extFromName = String(req.file.originalname || "")
      .split(".")
      .pop()
      ?.toLowerCase();

    const ext = extFromMime || extFromName || "bin";
    const key = `uploads/${Date.now()}-${randomUUID()}.${ext}`;

    // ✅ Efficient cache lifetime (safe because filename is unique)
    const cacheControl = "public, max-age=31536000, immutable";

    await r2.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: key,
        Body: req.file.buffer,
        ContentType: mime,
        CacheControl: cacheControl,
        ContentDisposition: "inline",
      })
    );

    const base = String(R2_PUBLIC_BASE_URL).replace(/\/+$/, "");
    const url = `${base}/${key}`;

    console.log(`[R2-upload] Success: ${url}`);

    return res.status(200).json({
      success: true,
      key,
      url,
    });
  } catch (err) {
    console.error("[R2-upload] Error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Upload failed",
    });
  }
});

export default router;
