// backend/Controllers/SitemapController.js
import asyncHandler from 'express-async-handler';
import Movie from '../Models/MoviesModel.js';
import Categories from '../Models/CategoriesModel.js';

const FRONTEND_BASE_URL = (
  process.env.PUBLIC_FRONTEND_URL || 'https://www.moviefrost.com'
).replace(/\/+$/, '');

// HTML-escape values in XML
const escapeXml = (unsafe = '') =>
  String(unsafe || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

// Treat "missing isPublished" as published
const publicVisibilityFilter = { isPublished: { $ne: false } };

/**
 * Convert any stored value (absolute URL, protocol-relative, domain-only, or path)
 * into a valid absolute HTTPS URL.
 */
const toAbsoluteUrl = (maybeUrl, base = FRONTEND_BASE_URL) => {
  const u = String(maybeUrl || '').trim();
  if (!u) return '';

  // already absolute
  if (/^https?:\/\//i.test(u)) return u;

  // protocol-relative
  if (u.startsWith('//')) return `https:${u}`;

  // looks like "cdn.domain.com/path" (no scheme)
  if (/^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(u)) {
    return `https://${u}`;
  }

  // relative path
  return `${base}${u.startsWith('/') ? '' : '/'}${u}`;
};

const pickBestThumbnail = (...candidates) => {
  for (const c of candidates) {
    const abs = toAbsoluteUrl(c);
    if (abs) return abs;
  }
  // guaranteed existing fallback (your logo)
  return toAbsoluteUrl('/images/MOVIEFROST.png');
};

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

// ============== MAIN SITEMAP (pages) ==================
// GET /sitemap.xml
export const generateSitemap = asyncHandler(async (_req, res) => {
  const [movies, categories] = await Promise.all([
    Movie.find(publicVisibilityFilter).select('_id slug updatedAt').lean(),
    Categories.find({}).select('title updatedAt').lean(),
  ]);

  const staticPages = [
    { loc: `${FRONTEND_BASE_URL}/`, changefreq: 'daily', priority: '1.0' },
    {
      loc: `${FRONTEND_BASE_URL}/#popular`,
      changefreq: 'daily',
      priority: '0.8',
    },
    {
      loc: `${FRONTEND_BASE_URL}/movies`,
      changefreq: 'daily',
      priority: '0.9',
    },
    {
      loc: `${FRONTEND_BASE_URL}/about-us`,
      changefreq: 'weekly',
      priority: '0.7',
    },
    {
      loc: `${FRONTEND_BASE_URL}/contact-us`,
      changefreq: 'weekly',
      priority: '0.7',
    },
  ];

  const urls = [];

  // Static pages
  urls.push(...staticPages);

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
  .map((u) => {
    return `  <url>
    <loc>${escapeXml(u.loc)}</loc>
    ${u.lastmod ? `<lastmod>${escapeXml(u.lastmod)}</lastmod>` : ''}
    <changefreq>${escapeXml(u.changefreq)}</changefreq>
    <priority>${escapeXml(u.priority)}</priority>
  </url>`;
  })
  .join('\n')}
</urlset>`;

  setSitemapHeaders(res);
  res.send(xml);

  pingSearchEngines(`${FRONTEND_BASE_URL}/sitemap.xml`);
});

// ============== VIDEO SITEMAP ==================
// GET /sitemap-videos.xml
export const generateVideoSitemap = asyncHandler(async (_req, res) => {
  // Only include published titles that actually have a video URL
  const movies = await Movie.find({
    ...publicVisibilityFilter,
    type: 'Movie',
    video: { $nin: [null, ''] },
  })
    .select(
      '_id slug name desc image titleImage createdAt updatedAt video downloadUrl time category seoTitle seoDescription seoKeywords viewCount'
    )
    .lean();

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset
  xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
  xmlns:video="http://www.google.com/schemas/sitemap-video/1.1"
>
${movies
  .map((m) => {
    const pathSegment = m.slug || m._id;
    const pageUrl = `${FRONTEND_BASE_URL}/watch/${pathSegment}`;

    const contentUrlRaw = m.downloadUrl || m.video || pageUrl;
    const contentUrl = toAbsoluteUrl(contentUrlRaw, FRONTEND_BASE_URL);

    // ✅ This is the important part (thumbnail)
    const thumb = pickBestThumbnail(
      m.image,
      m.titleImage,
      '/og-image.jpg',
      '/images/MOVIEFROST.png'
    );

    const title = m.seoTitle || m.name || 'Movie';
    const descriptionRaw =
      (m.seoDescription || m.desc || '').substring(0, 2048) ||
      'Watch free movies and web series online on MovieFrost.';

    const uploadDate = m.createdAt || m.updatedAt
      ? new Date(m.createdAt || m.updatedAt).toISOString()
      : new Date().toISOString();

    const durationSeconds = m.time ? Number(m.time) * 60 : undefined;

    const tags =
      typeof m.seoKeywords === 'string'
        ? m.seoKeywords
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean)
        : [];

    return `  <url>
    <loc>${escapeXml(pageUrl)}</loc>
    <video:video>
      <video:thumbnail_loc>${escapeXml(thumb)}</video:thumbnail_loc>
      <video:title>${escapeXml(title)}</video:title>
      <video:description>${escapeXml(descriptionRaw)}</video:description>
      <video:content_loc>${escapeXml(contentUrl)}</video:content_loc>
      <video:player_loc>${escapeXml(pageUrl)}</video:player_loc>
      <video:publication_date>${escapeXml(uploadDate)}</video:publication_date>
      ${
        durationSeconds
          ? `<video:duration>${durationSeconds}</video:duration>`
          : ''
      }
      ${
        m.category
          ? `<video:category>${escapeXml(m.category)}</video:category>`
          : ''
      }
      ${
        typeof m.viewCount === 'number'
          ? `<video:view_count>${m.viewCount}</video:view_count>`
          : ''
      }
      ${
        tags.length
          ? tags
              .map((t) => `      <video:tag>${escapeXml(t)}</video:tag>`)
              .join('\n')
          : ''
      }
      <video:family_friendly>yes</video:family_friendly>
    </video:video>
  </url>`;
  })
  .join('\n')}
</urlset>`;

  setSitemapHeaders(res);
  res.send(xml);

  pingSearchEngines(`${FRONTEND_BASE_URL}/sitemap-videos.xml`);
});
