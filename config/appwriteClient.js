// backend/config/appwriteClient.js
import { Client, Storage, ID, InputFile, Permission, Role } from 'node-appwrite';
import dotenv from 'dotenv';

dotenv.config();

const client = new Client();
if (process.env.APPWRITE_ENDPOINT) client.setEndpoint(process.env.APPWRITE_ENDPOINT);
if (process.env.APPWRITE_PROJECT_ID) client.setProject(process.env.APPWRITE_PROJECT_ID);
if (process.env.APPWRITE_API_KEY) client.setKey(process.env.APPWRITE_API_KEY);

const storage = new Storage(client);

// Optional: log missing envs during cold starts
const required = ['APPWRITE_ENDPOINT', 'APPWRITE_PROJECT_ID', 'APPWRITE_API_KEY', 'APPWRITE_BUCKET_ID'];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error('Appwrite environment variables missing:', missing.join(', '));
}

export { storage, ID, InputFile, Permission, Role };
