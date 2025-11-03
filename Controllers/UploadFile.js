// backend/Controllers/UploadFile.js - 100% R2, no Appwrite
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
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

const {
  R2_BUCKET_NAME,
  R2_PUBLIC_BASE_URL
} = process.env;

/* ------------------------------------------------------------------ */
/* POST /api/upload - exactly the same endpoint the React code uses */
/* ------------------------------------------------------------------ */
router.post("/", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        message: "No file uploaded" 
      });
    }
    
    if (!R2_BUCKET_NAME || !R2_PUBLIC_BASE_URL) {
      console.error("R2 config missing:", { R2_BUCKET_NAME, R2_PUBLIC_BASE_URL });
      return res.status(500).json({ 
        success: false, 
        message: "R2 configuration missing" 
      });
    }

    // Generate unique filename
    const ext = req.file.originalname.split(".").pop();
    const key = `uploads/${Date.now()}-${randomUUID()}.${ext}`;

    // Upload to R2
    await r2.send(new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      Body: req.file.buffer,
      ContentType: req.file.mimetype,
      // Note: R2 doesn't use ACL like S3, public access is controlled by bucket settings
    }));

    // Return the public CDN URL
    const url = `${R2_PUBLIC_BASE_URL}/${key}`;
    
    console.log(`[R2-upload] Success: ${url}`);
    
    return res.status(200).json({
      success: true,
      key,
      url
    });

  } catch (err) {
    console.error("[R2-upload] Error:", err);
    return res.status(500).json({ 
      success: false, 
      message: err.message || "Upload failed" 
    });
  }
});

export default router;
