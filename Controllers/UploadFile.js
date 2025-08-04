// UploadFile.js
import express from 'express';
import multer from 'multer';
import { storage, ID } from '../config/appwriteClient.js';
import { InputFile } from 'node-appwrite';
import dotenv from 'dotenv';

dotenv.config();

const Uploadrouter = express.Router();

// Configure multer
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  }
});

Uploadrouter.post('/', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;

    // Check if file is available
    if (!file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const bucketId = process.env.APPWRITE_BUCKET_ID;

    // Upload to Appwrite using InputFile
    const response = await storage.createFile(
      bucketId,
      ID.unique(),
      InputFile.fromBuffer(file.buffer, file.originalname),
      ['role:all'] // public read permissions
    );

    // Construct the file URL
    const fileUrl = `${process.env.APPWRITE_ENDPOINT}/storage/buckets/${bucketId}/files/${response.$id}/view?project=${process.env.APPWRITE_PROJECT_ID}`;

    res.status(200).json({
      success: true,
      url: fileUrl,
      fileId: response.$id
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error uploading file'
    });
  }
});

export default Uploadrouter;
