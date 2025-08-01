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
import fs from 'fs';
import React from 'react';
import ReactDOMServer from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import { HelmetProvider } from 'react-helmet-async';

// Import App for SSR - adjust path if needed
// Note: You'll need to ensure your frontend App.js can be imported server-side
// This might require babel transpilation or adjusting the import
let App;
try {
  // Dynamic import to handle potential module issues
  App = (await import('../Frontend/src/App.js')).default;
} catch (error) {
  console.warn('SSR App import failed, falling back to static serving:', error);
}

dotenv.config();
const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Crawler detection regex
const CRAWLER_REGEXP = /(googlebot|bingbot|duckduckbot|slurp|linkedinbot|twitterbot|facebookexternalhit)/i;

// Load the built index.html template for SSR
let template;
try {
  const templatePath = path.join(__dirname, '../Frontend/build/index.html');
  if (fs.existsSync(templatePath)) {
    template = fs.readFileSync(templatePath, 'utf8');
  }
} catch (error) {
  console.warn('Could not load index.html template for SSR:', error);
}

// SSR function
function ssr(req, res) {
  if (!App || !template) {
    // Fallback to static serving if SSR isn't available
    return res.sendFile(path.join(__dirname, '../Frontend/build/index.html'));
  }

  try {
    // 1) Render React tree to string
    const helmetContext = {};
    const app = ReactDOMServer.renderToString(
      <HelmetProvider context={helmetContext}>
        <StaticRouter location={req.url}>
          <App />
        </StaticRouter>
      </HelmetProvider>
    );

    // 2) Pull all tags that Helmet components created
    const { helmet } = helmetContext;

    // 3) Inject the rendered app + tags into the HTML template
    const html = template
      .replace('<div id="root"></div>', `<div id="root">${app}</div>`)
      .replace(
        '<title>React App</title>',
        helmet.title.toString() + helmet.meta.toString() + helmet.link.toString()
      );

    // 4) Serve
    res.set('Content-Type', 'text/html');
    return res.send(html);
  } catch (error) {
    console.error('SSR rendering error:', error);
    // Fallback to static file
    return res.sendFile(path.join(__dirname, '../Frontend/build/index.html'));
  }
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
        "https://region1.google-analytics.com",
        "https://region2.google-analytics.com",
        "https://region3.google-analytics.com",
        "https://region4.google-analytics.com",
        "https://moviefrost.com",
        "https://www.moviefrost.com",
        "https://moviefrost-backend.vercel.app",
        "https://moviefrost-frontend.vercel.app",
        "https://c1.popads.net",
        "https://cdn.monetag.com",
        "https://a.monetag.com",
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

// CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:5000',
      'https://moviefrost.com',
      'https://www.moviefrost.com',
      'https://moviefrost-frontend.vercel.app',
      'https://moviefrost-frontend-*.vercel.app'
    ];
    
    if (!origin) {
      return callback(null, true);
    }
    
    if (allowedOrigins.some(allowedOrigin => {
      if (allowedOrigin.includes('*')) {
        const regex = new RegExp(allowedOrigin.replace('*', '.*'));
        return regex.test(origin);
      }
      return allowedOrigin === origin;
    })) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
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

// SSR Middleware for public SEO routes
app.get(
  /^\/$|^\/about-us$|^\/contact-us$|^\/movies.*|^\/movie\/[^/]+$|^\/watch\/[^/]+$/,
  (req, res, next) => {
    const userAgent = req.headers['user-agent'] || '';
    if (CRAWLER_REGEXP.test(userAgent) && template && App) {
      return ssr(req, res);
    }
    return next();
  }
);

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
  res.json({ message: 'MovieFrost API is running', version: '1.0.0' });
});

// Sitemap route
app.get('/sitemap.xml', async (req, res) => {
  try {
    const response = await fetch(`${process.env.API_URL || 'https://moviefrost-backend.vercel.app'}/api/movies/sitemap.xml`);
    const sitemap = await response.text();
    res.header('Content-Type', 'application/xml');
    res.send(sitemap);
  } catch (error) {
    res.status(500).send('Error generating sitemap');
  }
});

// Error handling
app.use(errorHandler);

// For Vercel deployment
if (process.env.NODE_ENV !== 'production') {
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
