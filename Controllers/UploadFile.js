// backend/Controllers/UploadFile.js
import express from 'express';
import multer from 'multer';
import dotenv from 'dotenv';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { storage, ID, Permission, Role } from '../config/appwriteClient.js';

dotenv.config();

const Uploadrouter = express.Router();

// Memory storage, 10 MB limit
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// Helper to compute public base URL for this backend (Vercel URL in prod)
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || (
  process.env.VERCEL_URL
    ? (process.env.VERCEL_URL.startsWith('http') ? process.env.VERCEL_URL : `https://${process.env.VERCEL_URL}`)
    : `http://localhost:${process.env.PORT || 5000}`
);

// Utility: try to create an Appwrite InputFile if available; otherwise fallback to fs stream
async function toAppwriteFileInput(fileBuffer, originalName) {
  try {
    // Dynamically import node-appwrite, in case version without InputFile is installed
    const mod = await import('node-appwrite');
    if (mod?.InputFile?.fromBuffer) {
      return { type: 'inputfile', value: mod.InputFile.fromBuffer(fileBuffer, originalName) };
    }
  } catch (_) {
    // ignore and fallback
  }

  // Fallback: write to a temp file and return a read stream
  const tmpPath = path.join(os.tmpdir(), `${Date.now()}-${Math.random().toString(36).slice(2)}-${originalName}`);
  await fs.promises.writeFile(tmpPath, fileBuffer);
  const stream = fs.createReadStream(tmpPath);
  return { type: 'stream', value: stream, tmpPath };
}

// POST /api/upload  -> upload to Appwrite (server-to-server)
Uploadrouter.post('/', upload.single('file'), async (req, res) => {
  let tmpToCleanup = null;

  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const { APPWRITE_BUCKET_ID, APPWRITE_PROJECT_ID, APPWRITE_ENDPOINT } = process.env;
    if (!APPWRITE_BUCKET_ID || !APPWRITE_PROJECT_ID || !APPWRITE_ENDPOINT) {
      console.error('Appwrite env missing, check: APPWRITE_BUCKET_ID, APPWRITE_PROJECT_ID, APPWRITE_ENDPOINT');
      return res.status(500).json({
        success: false,
        message: 'Storage configuration error',
      });
    }

    // Prepare input for node-appwrite: try InputFile, else fallback to fs stream
    const prepared = await toAppwriteFileInput(file.buffer, file.originalname);
    if (prepared.type === 'stream') {
      tmpToCleanup = prepared.tmpPath;
    }

    // If your bucket is File-level security ON, make new files publicly readable
    const permissions = [Permission.read(Role.any())];

    const created = await storage.createFile(
      APPWRITE_BUCKET_ID,
      ID.unique(),
      prepared.value,
      permissions
    );

    // IMPORTANT: Return our backend proxy URL, not cloud.appwrite.io
    const proxyUrl = `${PUBLIC_BASE_URL}/api/upload/file/${created.$id}/view`;

    return res.status(200).json({
      success: true,
      url: proxyUrl,
      fileId: created.$id,
    });
  } catch (error) {
    console.error('[Upload] Error:', error);
    return res.status(500).json({
      success: false,
      message: error?.message || 'Error uploading file',
    });
  } finally {
    // Cleanup any temporary file used for fallback
    if (tmpToCleanup) {
      fs.promises.unlink(tmpToCleanup).catch(() => {});
    }
  }
});

// GET /api/upload/file/:id/view  -> stream file bytes to the browser
Uploadrouter.get('/file/:id/view', async (req, res) => {
  try {
    const { id } = req.params;
    const { APPWRITE_BUCKET_ID } = process.env;

    if (!APPWRITE_BUCKET_ID) {
      return res.status(500).json({ success: false, message: 'Missing APPWRITE_BUCKET_ID' });
    }

    // 1) get metadata for proper mime type
    const meta = await storage.getFile(APPWRITE_BUCKET_ID, id);
    const mime = meta?.mimeType || 'application/octet-stream';

    // 2) get file "view" bytes from Appwrite
    const bufferOrStream = await storage.getFileView(APPWRITE_BUCKET_ID, id);

    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

    const buf = Buffer.isBuffer(bufferOrStream)
      ? bufferOrStream
      : Buffer.from(bufferOrStream);

    return res.status(200).send(buf);
  } catch (err) {
    console.error('[Upload view] error:', err?.message);
    return res.status(404).json({ success: false, message: 'File not found' });
  }
});

export default Uploadrouter;
