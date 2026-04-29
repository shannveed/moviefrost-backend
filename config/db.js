// backend/config/db.js
import mongoose from 'mongoose';

const globalForMongoose = globalThis;

if (!globalForMongoose.__MOVIEFROST_MONGOOSE_CACHE__) {
  globalForMongoose.__MOVIEFROST_MONGOOSE_CACHE__ = {
    conn: null,
    promise: null,
  };
}

const cache = globalForMongoose.__MOVIEFROST_MONGOOSE_CACHE__;

const printMongoHelp = (error) => {
  const msg = String(error?.message || error || '');

  console.error('❌ MongoDB connection failed:', msg);

  if (/bad auth|authentication failed/i.test(msg)) {
    console.error('');
    console.error('MongoDB auth checklist:');
    console.error('1) Replace YOUR_PASSWORD in MONGO_URI with the real Atlas DB user password.');
    console.error('2) If password has @ # : / ? & characters, URL-encode the password.');
    console.error('3) In Atlas > Database Access, confirm the username/password are correct.');
    console.error('4) In Atlas > Network Access, allow your current IP or 0.0.0.0/0 for testing.');
    console.error('5) Confirm the database user has access to the target database.');
    console.error('');
  }
};

// Connect MongoDB with mongoose
export const connectDB = async () => {
  const uri = String(process.env.MONGO_URI || '').trim();

  if (!uri) {
    const err = new Error('MONGO_URI is missing in environment variables');
    printMongoHelp(err);

    if (!process.env.VERCEL) process.exit(1);
    throw err;
  }

  if (cache.conn && mongoose.connection.readyState === 1) {
    return cache.conn;
  }

  if (!cache.promise) {
    cache.promise = mongoose.connect(uri, {
      serverSelectionTimeoutMS: 10000,
    });
  }

  try {
    cache.conn = await cache.promise;

    console.log(
      `MongoDB Connected: ${cache.conn.connection.host}/${cache.conn.connection.name}`
    );

    return cache.conn;
  } catch (error) {
    cache.promise = null;
    cache.conn = null;

    printMongoHelp(error);

    // Local dev should stop clearly.
    // Vercel/serverless should throw instead of process.exit.
    if (!process.env.VERCEL) {
      process.exit(1);
    }

    throw error;
  }
};
