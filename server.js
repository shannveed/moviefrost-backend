// backend/server.js
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import compression from 'compression';
import helmet from 'helmet';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import pushCampaignRouter from './routes/PushCampaignRouter.js';

import { connectDB } from './config/db.js';
import userRoutes from './routes/UserRouter.js';
import moviesRouter from './routes/MoviesRouter.js';
import categoriesRouter from './routes/CategoriesRouter.js';
import { errorHandler } from './middlewares/errorMiddleware.js';
import Uploadrouter from './Controllers/UploadFile.js';
import {
  generateSitemap,
  generateVideoSitemap,
  generateSitemapIndex,
  generateActorsSitemap,
} from './Controllers/SitemapController.js';
import notificationsRouter from './routes/NotificationsRouter.js';
import watchRequestsRouter from './routes/WatchRequestsRouter.js';
import pushRouter from './routes/PushRouter.js';
import actorsRouter from './routes/ActorsRouter.js';

dotenv.config();

// Ensure NODE_ENV always has a sensible default
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'development';
}
const NODE_ENV = process.env.NODE_ENV;

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Public backend host (used in CSP / CORS)
const BACKEND_HOST =
  process.env.BACKEND_PUBLIC_URL ||
  'https://moviefrost-backend.vercel.app';

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          "'unsafe-eval'",
          'https://www.googletagmanager.com',
          'https://www.google-analytics.com',
          'https://cdn.moviefrost.com',
          BACKEND_HOST,
          'https://www.moviefrost.com',
          'https://moviefrost.com',
          'https://apis.google.com',
          'https://accounts.google.com',
          'https://c1.popads.net',
          'https://cdn.monetag.com',
          'https://a.monetag.com',
          'https://pl27041508.profitableratecpm.com',
          'https://pl27010677.profitableratecpm.com',
          'https://pl27010453.profitableratecpm.com',
        ],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        imgSrc: [
          "'self'",
          'data:',
          'https:',
          'blob:',
          'https://cdn.moviefrost.com',
        ],
        connectSrc: [
          "'self'",
          'https://cdn.moviefrost.com',
          'https://www.google-analytics.com',
          'https://region1.google-analytics.com',
          'https://region2.google-analytics.com',
          'https://region3.google-analytics.com',
          'https://region4.google-analytics.com',
          'https://moviefrost.com',
          'https://www.moviefrost.com',
          BACKEND_HOST,
          'https://moviefrost-frontend.vercel.app',
          'https://moviefrost-frontend-*.vercel.app',
          'https://c1.popads.net',
          'https://cdn.monetag.com',
          'https://a.monetag.com',
          'https://accounts.google.com',
          'https://oauth2.googleapis.com',
          'https://www.googleapis.com',
          'wss://moviefrost.com',
        ],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'", 'https:', 'blob:', 'https://cdn.moviefrost.com'],
        frameSrc: [
          "'self'",
          'https:',
          'https://a.monetag.com',
          'https://accounts.google.com',
        ],
      },
    },
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    crossOriginEmbedderPolicy: false,
  })
);

// Compression
app.use(
  compression({
    level: 6,
    threshold: 1024,
    filter: (req, res) =>
      req.headers['x-no-compression']
        ? false
        : compression.filter(req, res),
  })
);

// CORS
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:5000',
      'https://moviefrost.com',
      'https://www.moviefrost.com',
      'https://moviefrost-frontend.vercel.app',
      'https://moviefrost-frontend-*.vercel.app',
      BACKEND_HOST,
    ];
    if (!origin) return callback(null, true);
    const ok = allowedOrigins.some((allowedOrigin) => {
      if (allowedOrigin.includes('*')) {
        const regex = new RegExp(allowedOrigin.replace('*.', '.*\\.'));
        return regex.test(origin);
      }
      return allowedOrigin === origin;
    });
    return ok ? callback(null, true) : callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Content-Length', 'X-Content-Type-Options'],
  optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));
app.set('trust proxy', 1);

// robots.txt for backend domain (frontend has its own /robots.txt)
app.use('/robots.txt', (_req, res) => {
  const robotsContent = `# MovieFrost Robots.txt (backend)
User-agent: *
Allow: /
Disallow: /api/

Sitemap: https://www.moviefrost.com/sitemap.xml
Sitemap: https://www.moviefrost.com/sitemap-videos.xml
`;
  res.type('text/plain').send(robotsContent);
});

// Sitemaps from backend
app.get('/sitemap.xml', generateSitemap);
app.get('/sitemap-videos.xml', generateVideoSitemap);
app.get('/sitemap-index.xml', generateSitemapIndex);
app.get('/sitemap-actors.xml', generateActorsSitemap);

// Cache headers for static-like assets if ever served from backend
app.use((req, res, next) => {
  if (req.url.match(/\.(js|css|jpg|jpeg|png|gif|ico|svg|woff|woff2|ttf|eot)$/)) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  }
  next();
});

// Parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// DB
connectDB();

// API routes
app.use('/api/users', userRoutes);
app.use('/api/movies', moviesRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/push-campaigns', pushCampaignRouter);
app.use('/api/upload', Uploadrouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/requests', watchRequestsRouter);
app.use('/api/push', pushRouter);
app.use('/api/actors', actorsRouter);

// Health
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Root
app.get('/', (_req, res) => {
  res.json({ message: 'MovieFrost API is running', version: '1.0.0' });
});

// Errors
app.use(errorHandler);

// Start HTTP server only locally (Vercel will use the exported app)
if (NODE_ENV !== 'production') {
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
    console.log(`Server running in ${NODE_ENV} mode on port ${PORT}`);
  });
}

export default app;
  