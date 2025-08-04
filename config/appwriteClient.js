// backend/config/appwriteClient.js
import { Client, Storage, ID, InputFile } from 'node-appwrite';
import dotenv from 'dotenv';
dotenv.config();

/*  Initialise once and share the same instance everywhere  */
const client = new Client()
  .setEndpoint(process.env.APPWRITE_ENDPOINT)        // e.g. https://cloud.appwrite.io/v1
  .setProject(process.env.APPWRITE_PROJECT_ID)       // the project ID
  .setKey(process.env.APPWRITE_API_KEY);             // **server-side key**

export const storage = new Storage(client);
export { ID, InputFile };          //  <-- NEW export
