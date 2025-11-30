// backend/Controllers/SitemapController.js
import asyncHandler from 'express-async-handler';
import Movie from '../Models/MoviesModel.js';
import Categories from '../Models/CategoriesModel.js';

const FRONTEND_BASE_URL =
  process.env.PUBLIC_FRONTEND_URL || 'https://www.moviefrost.com';

// Small helper to HTML-escape values in XML (just in case)
const escapeXml = (unsafe = '') =>
  String(unsafe || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

// ============== MAIN SITEMAP (pages) ==================
// GET /sitemap.xml
export const generateSitemap = asyncHandler(async (_req, res) => {
  try {
    const [movies, categories] = await Promise.all([
      Movie.find({}).select('_id updatedAt').lean(),
      Categories.find({}).select('title updatedAt').lean(),
    ]);

    const staticPages = [
      {
        loc: `${FRONTEND_BASE_URL}/`,
        changefreq: 'daily',
        priority: '1.0',
      },
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
    for (const page of staticPages) {
      urls.push({
        loc: page.loc,
        changefreq: page.changefreq,
        priority: page.priority,
      });
    }

    // Movie detail pages
    for (const movie of movies) {
      const lastmod = movie.updatedAt
        ? new Date(movie.updatedAt).toISOString()
        : undefined;

      urls.push({
        loc: `${FRONTEND_BASE_URL}/movie/${movie._id}`,
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
        loc: `${FRONTEND_BASE_URL}/movies?category=${encodeURIComponent(
          title
        )}`,
        lastmod,
        changefreq: 'weekly',
        priority: '0.7',
      });
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset
  xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
>
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

    res.header('Content-Type', 'application/xml; charset=UTF-8');
    res.send(xml);

    // Ping Google & Bing (only in production)
    try {
      if (process.env.NODE_ENV === 'production') {
        const sitemapUrl = encodeURIComponent(
          `${FRONTEND_BASE_URL}/sitemap.xml`
        );
        // global fetch is available in Node 18+/Vercel runtime
        fetch(`https://www.google.com/ping?sitemap=${sitemapUrl}`).catch(
          () => {}
        );
        fetch(`https://www.bing.com/ping?sitemap=${sitemapUrl}`).catch(
          () => {}
        );
      }
    } catch {
      // ignore ping failures
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ============== VIDEO SITEMAP ==================
// GET /sitemap-videos.xml
export const generateVideoSitemap = asyncHandler(async (_req, res) => {
  try {
    // Only include movies that actually have video URLs
    const movies = await Movie.find({
      type: 'Movie',
      video: { $ne: null },
    })
      .select(
        '_id name desc image titleImage createdAt updatedAt video downloadUrl time category seoTitle seoDescription seoKeywords viewCount'
      )
      .lean();

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset
  xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
  xmlns:video="http://www.google.com/schemas/sitemap-video/1.1"
>
${movies
  .map((m) => {
    const pageUrl = `${FRONTEND_BASE_URL}/watch/${m._id}`;
    const contentUrl = m.downloadUrl || m.video || pageUrl;

    const rawThumb = m.image || m.titleImage || `${FRONTEND_BASE_URL}/og-image.jpg`;
    const thumb =
      typeof rawThumb === 'string' && rawThumb.startsWith('http')
        ? rawThumb
        : `${FRONTEND_BASE_URL}${
            rawThumb.startsWith('/') ? '' : '/'
          }${rawThumb}`;

    const title = m.seoTitle || m.name || 'Movie';
    const descriptionRaw =
      (m.seoDescription || m.desc || '').substring(0, 2048) ||
      'Watch free movies and web series online on MovieFrost.';
    const uploadDate = (m.createdAt || m.updatedAt
      ? new Date(m.createdAt || m.updatedAt).toISOString()
      : new Date().toISOString());
    const durationSeconds = m.time ? m.time * 60 : undefined;

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

    res.header('Content-Type', 'application/xml; charset=UTF-8');
    res.send(xml);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});
