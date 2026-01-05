// backend/Controllers/ShareController.js
import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import Movie from '../Models/MoviesModel.js';

const FRONTEND_BASE_URL =
  process.env.PUBLIC_FRONTEND_URL || 'https://www.moviefrost.com';

// Same rule as your public API: only show movies where isPublished !== false
const publicVisibilityFilter = { isPublished: { $ne: false } };

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

const escapeHtml = (unsafe = '') =>
  String(unsafe || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const toAbsoluteUrl = (maybeUrl) => {
  if (!maybeUrl) return `${FRONTEND_BASE_URL}/og-image.jpg`;
  const u = String(maybeUrl).trim();
  if (!u) return `${FRONTEND_BASE_URL}/og-image.jpg`;
  if (u.startsWith('http://') || u.startsWith('https://')) return u;
  return `${FRONTEND_BASE_URL}${u.startsWith('/') ? '' : '/'}${u}`;
};

/**
 * Public share page for crawlers (Telegram, WhatsApp, FB, etc.)
 * URL: /share/movie/:idOrSlug
 * This returns HTML with OG tags (server-side), so Telegram can read og:image.
 */
export const shareMoviePage = asyncHandler(async (req, res) => {
  const param = String(req.params.id || '').trim();

  if (!param) {
    res.status(400).send('Bad Request');
    return;
  }

  let movie = null;

  // 1) Try ObjectId
  if (isValidObjectId(param)) {
    movie = await Movie.findOne({ _id: param, ...publicVisibilityFilter })
      .select('_id slug name desc titleImage image seoTitle seoDescription type')
      .lean();
  }

  // 2) Try slug
  if (!movie) {
    movie = await Movie.findOne({ slug: param, ...publicVisibilityFilter })
      .select('_id slug name desc titleImage image seoTitle seoDescription type')
      .lean();
  }

  if (!movie) {
    res.status(404).send('Not found');
    return;
  }

  const pathSegment = movie.slug || movie._id;
  const canonicalUrl = `${FRONTEND_BASE_URL}/movie/${pathSegment}`;

  // IMPORTANT: Use titleImage first (your requirement)
  const imageUrl = toAbsoluteUrl(movie.titleImage || movie.image);

  const title = (movie.seoTitle || movie.name || 'MovieFrost').trim();
  const description = (
    movie.seoDescription ||
    movie.desc ||
    'Watch free movies and web series online on MovieFrost.'
  )
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 200);

  const ogType = movie.type === 'WebSeries' ? 'video.tv_show' : 'video.movie';

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />

    <title>${escapeHtml(title)} | MovieFrost</title>
    <meta name="robots" content="noindex,follow" />
    <link rel="canonical" href="${escapeHtml(canonicalUrl)}" />

    <meta property="og:site_name" content="MovieFrost" />
    <meta property="og:type" content="${escapeHtml(ogType)}" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:image" content="${escapeHtml(imageUrl)}" />
    <meta property="og:url" content="${escapeHtml(canonicalUrl)}" />

    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${escapeHtml(imageUrl)}" />
  </head>
  <body style="margin:0;background:#080A1A;color:#fff;font-family:Arial,sans-serif;">
    <div style="max-width:720px;margin:40px auto;padding:16px;">
      <h1 style="font-size:18px;margin:0 0 10px;">Redirecting…</h1>
      <p style="color:#C0C0C0;margin:0 0 12px;">
        If you are not redirected automatically, open:
        <a href="${escapeHtml(canonicalUrl)}" style="color:#1B82FF;">${escapeHtml(
    canonicalUrl
  )}</a>
      </p>
    </div>

    <script>
      // Redirect real users to your SPA route.
      window.location.replace(${JSON.stringify(canonicalUrl)});
    </script>
  </body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=600');
  res.status(200).send(html);
});
