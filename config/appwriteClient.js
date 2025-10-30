// backend/config/appwriteClient.js
import { Client, Storage, ID, InputFile, Permission, Role } from 'node-appwrite';
import dotenv from 'dotenv';

dotenv.config();

// Validate envs early and fail fast in logs
const required = ['APPWRITE_ENDPOINT', 'APPWRITE_PROJECT_ID', 'APPWRITE_API_KEY', 'APPWRITE_BUCKET_ID'];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error('Appwrite environment variables missing:', missing.join(', '));
  // We do not throw here to avoid crashing cold starts on serverless,
  // but Upload controller will still check and return 500 with a clear message.
}

const client = new Client();
if (process.env.APPWRITE_ENDPOINT) client.setEndpoint(process.env.APPWRITE_ENDPOINT);
if (process.env.APPWRITE_PROJECT_ID) client.setProject(process.env.APPWRITE_PROJECT_ID);
if (process.env.APPWRITE_API_KEY) client.setKey(process.env.APPWRITE_API_KEY);

const storage = new Storage(client);

// Optional: lightweight test log on cold start
(async () => {
  try {
    if (!process.env.APPWRITE_BUCKET_ID) throw new Error('APPWRITE_BUCKET_ID is not configured');
    if (!process.env.APPWRITE_PROJECT_ID) throw new Error('APPWRITE_PROJECT_ID is not configured');
    console.log('[Appwrite] Client configured. Bucket:', process.env.APPWRITE_BUCKET_ID);
  } catch (err) {
    console.error('[Appwrite] Configuration error:', err.message);
  }
})();

export { storage, ID, InputFile, Permission, Role };