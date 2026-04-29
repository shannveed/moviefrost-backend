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
import blogRouter from './routes/BlogRouter.js';
import { errorHandler } from './middlewares/errorMiddleware.js';
import Uploadrouter from './Controllers/UploadFile.js';
import {
  generateSitemap,
  generateSitemapIndex,
  generateActorsSitemap,
} from './Controllers/SitemapController.js';
import notificationsRouter from './routes/NotificationsRouter.js';
import watchRequestsRouter from './routes/WatchRequestsRouter.js';
import pushRouter from './routes/PushRouter.js';
import actorsRouter from './routes/ActorsRouter.js';

dotenv.config();

if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'development';
}

const NODE_ENV = process.env.NODE_ENV;
const IS_VERCEL = !!process.env.VERCEL;

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const normalizeOrigin = (value = '', fallback = '') => {
  let v = String(value || fallback || '').trim();

  if (!v) return '';

  if (!/^https?:\/\//i.test(v)) {
    v = `https://${v.replace(/^\/+/, '')}`;
  }

  v = v.replace(/\/+$/, '');

  // PUBLIC_BASE_URL may be https://domain.com/api
  v = v.replace(/\/api$/i, '');

  try {
    const u = new URL(v);
    return `${u.protocol}//${u.host}`;
  } catch {
    return v;
  }
};

const uniqueList = (items = []) =>
  Array.from(
    new Set((items || []).map((x) => String(x || '').trim()).filter(Boolean))
  );

const parseCsvList = (value = '') =>
  String(value || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

const FRONTEND_BASE_URL = normalizeOrigin(
  process.env.PUBLIC_FRONTEND_URL,
  'https://www.moviefrost.com'
);

const BACKEND_HOST = normalizeOrigin(
  process.env.BACKEND_PUBLIC_URL || process.env.PUBLIC_BASE_URL,
  'https://moviefrost-backend-peach.vercel.app'
);

/**
 * You can add extra origins without editing code:
 * CORS_ALLOWED_ORIGINS=https://preview1.vercel.app,https://preview2.vercel.app
 */
const EXTRA_ALLOWED_ORIGINS = parseCsvList(process.env.CORS_ALLOWED_ORIGINS).map(
  (origin) => normalizeOrigin(origin)
);

const DEFAULT_ALLOWED_ORIGINS = uniqueList([
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5000',
  'http://127.0.0.1:5000',

  // English production
  'https://moviefrost.com',
  'https://www.moviefrost.com',

  // Hindi production
  'https://hi.moviefrost.com',
  'https://www.hi.moviefrost.com',
  'https://api-hi.moviefrost.com',

  // Existing/possible Vercel deployments
  'https://moviefrost-frontend.vercel.app',
  'https://moviefrost-frontend-*.vercel.app',
  'https://frontend-next-ivory-nu.vercel.app',
  'https://moviefrost-frontend-next-ivory-nu*.vercel.app',

  FRONTEND_BASE_URL,
  BACKEND_HOST,
]);

const ALLOWED_ORIGINS = uniqueList([
  ...DEFAULT_ALLOWED_ORIGINS,
  ...EXTRA_ALLOWED_ORIGINS,
]);

const escapeRegex = (value = '') =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const wildcardToRegex = (pattern = '') => {
  const escaped = escapeRegex(pattern).replace(/\\\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i');
};

const originMatchesAllowed = (origin = '') => {
  const cleanOrigin = normalizeOrigin(origin);
  if (!cleanOrigin) return false;

  return ALLOWED_ORIGINS.some((allowed) => {
    const cleanAllowed = normalizeOrigin(allowed);
    if (!cleanAllowed) return false;

    if (cleanAllowed.includes('*')) {
      return wildcardToRegex(cleanAllowed).test(cleanOrigin);
    }

    return cleanAllowed === cleanOrigin;
  });
};

const cspFrontendOrigins = uniqueList([
  FRONTEND_BASE_URL,
  'https://moviefrost.com',
  'https://www.moviefrost.com',
  'https://hi.moviefrost.com',
  'https://www.hi.moviefrost.com',
]);

const cspBackendOrigins = uniqueList([
  BACKEND_HOST,
  'https://api-hi.moviefrost.com',
]);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: uniqueList([
          "'self'",
          "'unsafe-inline'",
          "'unsafe-eval'",
          'https://www.googletagmanager.com',
          'https://www.google-analytics.com',
          'https://cdn.moviefrost.com',
          ...cspBackendOrigins,
          ...cspFrontendOrigins,
          'https://apis.google.com',
          'https://accounts.google.com',
          'https://c1.popads.net',
          'https://cdn.monetag.com',
          'https://a.monetag.com',
          'https://pl27041508.profitableratecpm.com',
          'https://pl27010677.profitableratecpm.com',
          'https://pl27010453.profitableratecpm.com',
        ]),
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        imgSrc: [
          "'self'",
          'data:',
          'https:',
          'blob:',
          'https://cdn.moviefrost.com',
        ],
        connectSrc: uniqueList([
          "'self'",
          'https://cdn.moviefrost.com',
          'https://www.google-analytics.com',
          'https://region1.google-analytics.com',
          'https://region2.google-analytics.com',
          'https://region3.google-analytics.com',
          'https://region4.google-analytics.com',
          ...cspFrontendOrigins,
          ...cspBackendOrigins,
          'https://frontend-next-ivory-nu.vercel.app',
          'https://moviefrost-frontend-next-ivory-nu*.vercel.app',
          'https://c1.popads.net',
          'https://cdn.monetag.com',
          'https://a.monetag.com',
          'https://accounts.google.com',
          'https://oauth2.googleapis.com',
          'https://www.googleapis.com',
          'wss://moviefrost.com',
          'wss://www.moviefrost.com',
          'wss://hi.moviefrost.com',
        ]),
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        objectSrc: ["'none'"],
        mediaSrc: [
          "'self'",
          'https:',
          'blob:',
          'https://cdn.moviefrost.com',
        ],
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

app.use(
  compression({
    level: 6,
    threshold: 1024,
    filter: (req, res) =>
      req.headers['x-no-compression'] ? false : compression.filter(req, res),
  })
);

const corsOptions = {
  origin(origin, callback) {
    // allow server-to-server / curl / same-origin requests without Origin header
    if (!origin) return callback(null, true);

    if (originMatchesAllowed(origin)) {
      return callback(null, true);
    }

    return callback(new Error(`Not allowed by CORS: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['Content-Length', 'X-Content-Type-Options'],
  optionsSuccessStatus: 200,
};

app.set('trust proxy', 1);

app.options('*', cors(corsOptions));
app.use(cors(corsOptions));

// robots.txt for backend domain.
// Main frontend robots.txt is generated by Next.js.
app.use('/robots.txt', (_req, res) => {
  const robotsContent = `# MovieFrost Robots.txt (backend)
User-agent: *
Allow: /
Disallow: /api/

Sitemap: ${FRONTEND_BASE_URL}/sitemap-index.xml
Sitemap: ${FRONTEND_BASE_URL}/sitemap.xml
`;

  res.type('text/plain').send(robotsContent);
});

// Sitemaps from backend
app.get('/sitemap.xml', generateSitemap);
app.get('/sitemap-index.xml', generateSitemapIndex);
app.get('/sitemap-actors.xml', generateActorsSitemap);

app.get('/sitemap-videos.xml', (_req, res) => {
  res
    .status(410)
    .set('Content-Type', 'text/plain; charset=UTF-8')
    .set('Cache-Control', 'public, max-age=86400, s-maxage=86400')
    .send('sitemap-videos.xml has been removed.');
});

app.use((req, res, next) => {
  if (
    req.url.match(/\.(js|css|jpg|jpeg|png|gif|ico|svg|woff|woff2|ttf|eot)$/)
  ) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  }
  next();
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

connectDB().catch((e) => {
  console.error('[startup] connectDB failed:', e?.message || e);
});

app.use('/api/users', userRoutes);
app.use('/api/movies', moviesRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/blog', blogRouter);
app.use('/api/push-campaigns', pushCampaignRouter);
app.use('/api/upload', Uploadrouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/requests', watchRequestsRouter);
app.use('/api/push', pushRouter);
app.use('/api/actors', actorsRouter);

app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'OK',
    mode: NODE_ENV,
    vercel: IS_VERCEL,
    frontend: FRONTEND_BASE_URL,
    backend: BACKEND_HOST,
    timestamp: new Date().toISOString(),
  });
});

app.get('/', (_req, res) => {
  res.json({
    message: 'MovieFrost API is running',
    version: '1.0.0',
    frontend: FRONTEND_BASE_URL,
  });
});

app.use(errorHandler);

// ✅ Local/non-Vercel runtime should listen.
// Vercel serverless should only export default app.
if (!IS_VERCEL) {
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
    console.log(`Frontend origin: ${FRONTEND_BASE_URL}`);
  });
}

export default app;
