// backend/Controllers/SitemapController.js
import asyncHandler from 'express-async-handler';
import Movie from '../Models/MoviesModel.js';
import Categories from '../Models/CategoriesModel.js';

const FRONTEND_BASE_URL = (
  process.env.PUBLIC_FRONTEND_URL || 'https://www.moviefrost.com'
).replace(/\/+$/, '');

// HTML-escape values in XML
const escapeXml = (unsafe = '') =>
  String(unsafe ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

// Treat "missing isPublished" as published
const publicVisibilityFilter = { isPublished: { $ne: false } };

const setSitemapHeaders = (res) => {
  res.header('Content-Type', 'application/xml; charset=UTF-8');
  // Helps Vercel edge caching + reduces DB hits and timeouts
  res.header(
    'Cache-Control',
    'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400'
  );
};

const pingSearchEngines = (sitemapUrl) => {
  try {
    if (process.env.NODE_ENV !== 'production') return;
    const encoded = encodeURIComponent(sitemapUrl);
    fetch(`https://www.google.com/ping?sitemap=${encoded}`).catch(() => {});
    fetch(`https://www.bing.com/ping?sitemap=${encoded}`).catch(() => {});
  } catch {
    // ignore ping failures
  }
};

/* ============================================================
   MAIN SITEMAP (pages)
   GET /sitemap.xml
   ============================================================ */
export const generateSitemap = asyncHandler(async (_req, res) => {
  const [movies, categories] = await Promise.all([
    Movie.find(publicVisibilityFilter).select('_id slug updatedAt').lean(),
    Categories.find({}).select('title updatedAt').lean(),
  ]);

  const staticPages = [
    { loc: `${FRONTEND_BASE_URL}/`, changefreq: 'daily', priority: '1.0' },
    { loc: `${FRONTEND_BASE_URL}/movies`, changefreq: 'daily', priority: '0.9' },
    { loc: `${FRONTEND_BASE_URL}/about-us`, changefreq: 'weekly', priority: '0.7' },
    { loc: `${FRONTEND_BASE_URL}/contact-us`, changefreq: 'weekly', priority: '0.7' },
  ];

  const urls = [...staticPages];

  // Movie detail pages
  for (const movie of movies) {
    const lastmod = movie.updatedAt
      ? new Date(movie.updatedAt).toISOString()
      : undefined;

    const pathSegment = movie.slug || movie._id;

    urls.push({
      loc: `${FRONTEND_BASE_URL}/movie/${pathSegment}`,
      lastmod,
      changefreq: 'weekly',
      priority: '0.8',
    });
  }

  // Category listing pages
  for (const cat of categories) {
    const title = cat.title || '';
    const lastmod = cat.updatedAt
      ? new Date(cat.updatedAt).toISOString()
      : undefined;

    urls.push({
      loc: `${FRONTEND_BASE_URL}/movies?category=${encodeURIComponent(title)}`,
      lastmod,
      changefreq: 'weekly',
      priority: '0.7',
    });
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) => `  <url>
    <loc>${escapeXml(u.loc)}</loc>
    ${u.lastmod ? `<lastmod>${escapeXml(u.lastmod)}</lastmod>` : ''}
    <changefreq>${escapeXml(u.changefreq)}</changefreq>
    <priority>${escapeXml(u.priority)}</priority>
  </url>`
  )
  .join('\n')}
</urlset>`;

  setSitemapHeaders(res);
  res.send(xml);

  pingSearchEngines(`${FRONTEND_BASE_URL}/sitemap.xml`);
});

/* ============================================================
   SITEMAP INDEX
   GET /sitemap-index.xml
   ✅ Video sitemap removed
   ============================================================ */
export const generateSitemapIndex = asyncHandler(async (_req, res) => {
  const now = new Date().toISOString();
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>${escapeXml(`${FRONTEND_BASE_URL}/sitemap.xml`)}</loc>
    <lastmod>${escapeXml(now)}</lastmod>
  </sitemap>
  <sitemap>
    <loc>${escapeXml(`${FRONTEND_BASE_URL}/sitemap-actors.xml`)}</loc>
    <lastmod>${escapeXml(now)}</lastmod>
  </sitemap>
</sitemapindex>`;

  setSitemapHeaders(res);
  res.send(xml);

  pingSearchEngines(`${FRONTEND_BASE_URL}/sitemap-index.xml`);
});

/* ============================================================
   ACTORS SITEMAP (optional, NOT in sitemap-index)
   GET /sitemap-actors.xml
   ============================================================ */
export const generateActorsSitemap = asyncHandler(async (_req, res) => {
  const movies = await Movie.find(publicVisibilityFilter)
    .select('casts director directorSlug updatedAt')
    .lean();

  const seen = new Map(); // slug -> lastmod ISO

  for (const m of movies) {
    const lastmod = m.updatedAt ? new Date(m.updatedAt).toISOString() : null;

    // director
    if (m.directorSlug) {
      if (!seen.has(m.directorSlug)) seen.set(m.directorSlug, lastmod);
    }

    // casts
    if (Array.isArray(m.casts)) {
      for (const c of m.casts) {
        const s = c?.slug || '';
        if (!s) continue;
        if (!seen.has(s)) seen.set(s, lastmod);
      }
    }
  }

  // safety cap
  const slugs = Array.from(seen.keys()).slice(0, 45000);

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${slugs
  .map((s) => {
    const loc = `${FRONTEND_BASE_URL}/actor/${s}`;
    const lm = seen.get(s);
    return `  <url>
    <loc>${escapeXml(loc)}</loc>
    ${lm ? `<lastmod>${escapeXml(lm)}</lastmod>` : ''}
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
  </url>`;
  })
  .join('\n')}
</urlset>`;

  setSitemapHeaders(res);
  res.send(xml);
});
