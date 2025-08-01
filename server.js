import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import compression from 'compression';
import helmet from 'helmet';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import { connectDB } from './config/db.js';
import userRoutes from './routes/UserRouter.js';
import moviesRouter from './routes/MoviesRouter.js';
import categoriesRouter from './routes/CategoriesRouter.js';
import { errorHandler } from './middlewares/errorMiddleware.js';
import Uploadrouter from './Controllers/UploadFile.js';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();
const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// SEO Improvement: Enforce 'www' subdomain and HTTPS in production
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    const host = req.headers.host;
    if (!host.startsWith('www.') && !host.startsWith('localhost')) {
      return res.redirect(301, `https://www.${host}${req.url}`);
    }
    next();
  });
}


// Enhanced security headers - Updated to allow PopAds, Monetag, and GA4 regional endpoints
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "'unsafe-inline'",
        "'unsafe-eval'",
        "https://www.googletagmanager.com",
        "https://www.google-analytics.com",
        "https://cloud.appwrite.io",
        "https://apis.google.com",
        "https://c1.popads.net",
        "https://cdn.monetag.com",
        "https://a.monetag.com",
        "https://pl27041508.profitableratecpm.com",
        "https://pl27010677.profitableratecpm.com",
        "https://pl27010453.profitableratecpm.com"
      ],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      connectSrc: [
        "'self'",
        "https://cloud.appwrite.io",
        "https://www.google-analytics.com",
        "https://region1.google-analytics.com", // Added for EU GA4
        "https://region2.google-analytics.com", // Added for other regions
        "https://region3.google-analytics.com", // Added for other regions
        "https://region4.google-analytics.com", // Added for other regions
        "https://moviefrost.com",
        "https://www.moviefrost.com",
        "https://moviefrost-backend.vercel.app",
        "https://moviefrost-frontend.vercel.app",
        "https://c1.popads.net",
        "https://cdn.monetag.com",
        "https://a.monetag.com",
        "wss://www.moviefrost.com", // UPDATED for www
        "wss://moviefrost.com"
      ],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'", "https:", "blob:"],
      frameSrc: ["'self'", "https:", "https://a.monetag.com"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  crossOriginEmbedderPolicy: false,
}));

// Compression with optimized settings
app.use(compression({
  level: 6,
  threshold: 1024,
  filter: (req, res) => {
    if (req.headers['x-no-compression']) {
      return false;
    }
    return compression.filter(req, res);
  }
}));

// Update the corsOptions in your server.js
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:5000',
      'https://moviefrost.com',
      'https://www.moviefrost.com', // Added www
      'https://moviefrost-frontend.vercel.app',
      /https:\/\/moviefrost-frontend-.*\.vercel\.app$/, // Regex for preview deployments
    ];
    
    // Allow requests with no origin (like mobile apps, server-to-server)
    if (!origin) {
      return callback(null, true);
    }
    
    // Check if the origin is allowed
    if (allowedOrigins.some(allowedOrigin => {
      if (allowedOrigin instanceof RegExp) {
        return allowedOrigin.test(origin);
      }
      return allowedOrigin === origin;
    })) {
      callback(null, true);
    } else {
      callback(new Error(`Not allowed by CORS: ${origin}`));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Content-Length', 'X-Content-Type-Options'],
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));

// Trust proxy - Important for Vercel
app.set('trust proxy', 1);

// Cache control for static assets
app.use((req, res, next) => {
  if (req.url.match(/\.(js|css|jpg|jpeg|png|gif|ico|svg|woff|woff2|ttf|eot)$/)) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  }
  next();
});

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Connect DB
connectDB();

// API routes
app.use('/api/users', userRoutes);
app.use('/api/movies', moviesRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/upload', Uploadrouter);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({ message: 'MovieFrost API is running', version: '1.0.1' });
});

// Sitemap route - Let frontend handle this or proxy correctly
app.get('/sitemap.xml', async (req, res) => {
  try {
    // This proxies the request to the internal API route that generates the sitemap
    const apiUrl = process.env.API_URL || 'https://www.moviefrost.com';
    const response = await fetch(`${apiUrl}/api/movies/sitemap.xml`);
    if (!response.ok) {
        throw new Error(`Sitemap generation failed with status: ${response.status}`);
    }
    const sitemap = await response.text();
    res.header('Content-Type', 'application/xml');
    res.send(sitemap);
  } catch (error) {
    console.error("Sitemap proxy error:", error);
    res.status(500).send('Error generating sitemap');
  }
});

// Error handling
app.use(errorHandler);

// For Vercel deployment, we don't need to create HTTP server or listen
// Vercel handles this automatically
if (process.env.NODE_ENV !== 'production') {
  // Socket.io setup for local development only
  const httpServer = createServer(app);
  const io = new SocketServer(httpServer, {
    cors: corsOptions,
    transports: ['websocket', 'polling'],
  });

  io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);
    socket.on('disconnect', () => {
      console.log(`Socket disconnected: ${socket.id}`);
    });
  });

  const PORT = process.env.PORT || 5000;
  httpServer.listen(PORT, () => {
    console.log(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
  });
}

// Export for Vercel
export default app;
