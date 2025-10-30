// backend/Controllers/UploadFile.js
import express from 'express';
import multer from 'multer';
import dotenv from 'dotenv';
import { storage, ID, InputFile, Permission, Role } from '../config/appwriteClient.js';

dotenv.config();

const Uploadrouter = express.Router();

// Memory storage, 10 MB limit
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// Helper to compute public base URL for this backend (Vercel URL in prod)
const PUBLIC_BASE_URL =
  process.env.PUBLIC_BASE_URL ||
  process.env.VERCEL_URL?.startsWith('http')
    ? process.env.VERCEL_URL
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:5000';

// POST /api/upload  -> upload to Appwrite (server-to-server)
Uploadrouter.post('/', upload.single('file'), async (req, res) => {
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

    // Build proper input file for node-appwrite
    const input = InputFile.fromBuffer(file.buffer, file.originalname);

    // If your bucket is File-level security ON, make new files publicly readable
    const permissions = [Permission.read(Role.any())];

    const created = await storage.createFile(
      APPWRITE_BUCKET_ID,
      ID.unique(),
      input,
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

    // Send with long cache so images are fast
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

    // node-appwrite returns Buffer in Node; handle both Buffer or ArrayBuffer
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
