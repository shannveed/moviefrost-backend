// backend/Controllers/SitemapController.js
import asyncHandler from 'express-async-handler';
import Movie from '../Models/MoviesModel.js';
import Categories from '../Models/CategoriesModel.js';
import {
  getPublishedGenrePages,
  getPublishedIndustryPages,
  getPublishedLanguagePages,
  getPublishedYearPages,
} from '../utils/discoveryPages.js';

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
  res.header(
    'Cache-Control',
    'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400'
  );
};

const pingSearchEngines = (sitemapUrl) => {
  try {
    if (process.env.NODE_ENV !== 'production') return;
    const encoded = encodeURIComponent(sitemapUrl);
    fetch(`https://www.google.com/ping?sitemap=${encoded}`).catch(() => { });
    fetch(`https://www.bing.com/ping?sitemap=${encoded}`).catch(() => { });
  } catch {
    // ignore ping failures
  }
};

const addUniqueUrl = (urls, seen, entry) => {
  const loc = String(entry?.loc || '').trim();
  if (!loc || seen.has(loc)) return;
  seen.add(loc);
  urls.push(entry);
};

/* ============================================================
   MAIN SITEMAP
   GET /sitemap.xml
   ============================================================ */
export const generateSitemap = asyncHandler(async (_req, res) => {
  const [
    movies,
    categoryDocs,
    publishedCategoryValues,
    languageValues,
    yearValues,
    browseByValues,
  ] = await Promise.all([
    Movie.find(publicVisibilityFilter).select('_id slug updatedAt').lean(),

    // Same source as frontend /genre/[slug] route
    Categories.find({ title: { $nin: [null, ''] } }).select('title').lean(),

    // Published exact category values used to guarantee real content
    Movie.distinct('category', {
      ...publicVisibilityFilter,
      category: { $nin: [null, ''] },
    }),

    // Published exact language values used to guarantee real content
    Movie.distinct('language', {
      ...publicVisibilityFilter,
      language: { $nin: [null, ''] },
    }),

    Movie.distinct('year', {
      ...publicVisibilityFilter,
      year: { $nin: [null, ''] },
    }),

    Movie.distinct('browseBy', {
      ...publicVisibilityFilter,
      browseBy: { $nin: [null, ''] },
    }),
  ]);

  // ✅ Genre pages now use SAME source as frontend route:
  // Categories collection + exact published content check
  const genrePages = getPublishedGenrePages(
    (categoryDocs || []).map((c) => c?.title),
    publishedCategoryValues
  );

  // ✅ Language pages now use SAME supported set as frontend route
  // + exact published content check
  const languagePages = getPublishedLanguagePages(languageValues);

  const yearPages = getPublishedYearPages(yearValues);
  const industryPages = getPublishedIndustryPages(browseByValues);

  const now = new Date().toISOString();
  const urls = [];
  const seen = new Set();

  const staticPages = [
    { loc: `${FRONTEND_BASE_URL}/`, changefreq: 'daily', priority: '1.0' },
    { loc: `${FRONTEND_BASE_URL}/movies`, changefreq: 'daily', priority: '0.9' },
    { loc: `${FRONTEND_BASE_URL}/about-us`, changefreq: 'weekly', priority: '0.7' },
    { loc: `${FRONTEND_BASE_URL}/contact-us`, changefreq: 'weekly', priority: '0.7' },
    { loc: `${FRONTEND_BASE_URL}/dmca`, changefreq: 'monthly', priority: '0.6' },
    {
      loc: `${FRONTEND_BASE_URL}/privacy-policy`,
      changefreq: 'monthly',
      priority: '0.6',
    },
    {
      loc: `${FRONTEND_BASE_URL}/terms-of-service`,
      changefreq: 'monthly',
      priority: '0.6',
    },
  ];

  for (const page of staticPages) addUniqueUrl(urls, seen, page);

  // Movie detail pages
  for (const movie of movies) {
    const lastmod = movie.updatedAt
      ? new Date(movie.updatedAt).toISOString()
      : undefined;

    const pathSegment = movie.slug || movie._id;

    addUniqueUrl(urls, seen, {
      loc: `${FRONTEND_BASE_URL}/movie/${pathSegment}`,
      lastmod,
      changefreq: 'weekly',
      priority: '0.8',
    });
  }

  // Genre landing pages (frontend-safe + content-safe)
  for (const genre of genrePages) {
    addUniqueUrl(urls, seen, {
      loc: `${FRONTEND_BASE_URL}/genre/${genre.slug}`,
      lastmod: now,
      changefreq: 'weekly',
      priority: '0.8',
    });
  }

  // Industry landing pages
  for (const industry of industryPages) {
    addUniqueUrl(urls, seen, {
      loc: `${FRONTEND_BASE_URL}/industry/${industry.slug}`,
      lastmod: now,
      changefreq: 'weekly',
      priority: '0.85',
    });
  }

  // Year landing pages
  for (const year of yearPages) {
    addUniqueUrl(urls, seen, {
      loc: `${FRONTEND_BASE_URL}/year/${year.slug}`,
      lastmod: now,
      changefreq: 'weekly',
      priority: '0.75',
    });
  }

  // Language landing pages (frontend-safe + content-safe)
  for (const language of languagePages) {
    addUniqueUrl(urls, seen, {
      loc: `${FRONTEND_BASE_URL}/language/${language.slug}`,
      lastmod: now,
      changefreq: 'weekly',
      priority: '0.75',
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
   ============================================================ */
export const generateSitemapIndex = asyncHandler(async (_req, res) => {
  const now = new Date().toISOString();

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>${escapeXml(`${FRONTEND_BASE_URL}/sitemap.xml`)}</loc>
    <lastmod>${escapeXml(now)}</lastmod>
  </sitemap>
</sitemapindex>`;

  setSitemapHeaders(res);
  res.send(xml);

  pingSearchEngines(`${FRONTEND_BASE_URL}/sitemap-index.xml`);
});

/* ============================================================
   ACTORS SITEMAP
   GET /sitemap-actors.xml
   ============================================================ */
export const generateActorsSitemap = asyncHandler(async (_req, res) => {
  res
    .status(410)
    .set('Content-Type', 'text/plain; charset=utf-8')
    .set('Cache-Control', 'public, max-age=86400, s-maxage=86400')
    .set('X-Robots-Tag', 'noindex, follow')
    .send('sitemap-actors.xml has been removed.');
});
