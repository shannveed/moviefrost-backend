// backend/Controllers/UploadFile.js
import express from 'express';
import multer from 'multer';
import { storage, ID, InputFile } from '../config/appwriteClient.js';

/* --------  Multer in-memory storage (10 MB limit) -------- */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const router = express.Router();

/*  POST /api/upload  ------------------------------------------------- */
router.post('/', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file received' });
    }

    /*  Upload to Appwrite Storage  */
    const bucketId = process.env.APPWRITE_BUCKET_ID;
    const appwriteResponse = await storage.createFile(
      bucketId,
      ID.unique(),
      InputFile.fromBuffer(req.file.buffer, req.file.originalname), // 👈 important
      ['role:all'],                                                 // public read
    );

    const url =
      `${process.env.APPWRITE_ENDPOINT}/storage/buckets/${bucketId}` +
      `/files/${appwriteResponse.$id}/view?project=${process.env.APPWRITE_PROJECT_ID}`;

    res.status(201).json({ success: true, url, fileId: appwriteResponse.$id });
  } catch (err) {
    console.error('Upload failed:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
