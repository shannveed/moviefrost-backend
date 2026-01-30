// backend/Controllers/ActorsController.js
import asyncHandler from 'express-async-handler';
import Movie from '../Models/MoviesModel.js';
import { escapeRegex, slugify } from '../utils/slugify.js';

const publicVisibilityFilter = { isPublished: { $ne: false } };

const clampLimit = (value, fallback = 24, max = 60) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
};

/**
 * PUBLIC
 * GET /api/actors/:slug?page=1&limit=24
 * Returns titles where person appears in casts OR as director
 */
export const getActorBySlug = asyncHandler(async (req, res) => {
  const slug = String(req.params.slug || '').trim().toLowerCase();
  if (!slug) {
    res.status(400);
    throw new Error('Actor slug is required');
  }

  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = clampLimit(req.query.limit, 24, 60);
  const skip = (page - 1) * limit;

  const guessedName = slug.replace(/-+/g, ' ').trim();
  const nameRegex = new RegExp(`^${escapeRegex(guessedName)}$`, 'i');

  const filter = {
    ...publicVisibilityFilter,
    $or: [
      { 'casts.slug': slug },
      { directorSlug: slug },
      { 'casts.name': nameRegex },
      { director: nameRegex },
    ],
  };

  const [total, rows] = await Promise.all([
    Movie.countDocuments(filter),
    Movie.find(filter)
      .sort({ latest: -1, orderIndex: 1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select(
        '_id slug name titleImage image thumbnailInfo type category year director directorSlug casts'
      )
      .lean(),
  ]);

  if (!total) {
    res.status(404);
    throw new Error('Actor not found');
  }

  // best-effort resolve display name + image + roles
  let displayName = guessedName;
  let image = '';
  const roles = new Set();

  for (const m of rows) {
    if (m?.director && slugify(m.director) === slug) {
      displayName = m.director;
      roles.add('director');
    }

    const castMatch = Array.isArray(m?.casts)
      ? m.casts.find(
          (c) =>
            c?.slug === slug ||
            slugify(c?.name || '') === slug ||
            nameRegex.test(String(c?.name || ''))
        )
      : null;

    if (castMatch) {
      displayName = castMatch.name || displayName;
      image = image || castMatch.image || '';
      roles.add('actor');
    }

    if (image && roles.size >= 1) break;
  }

  res.setHeader(
    'Cache-Control',
    'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400'
  );

  res.json({
    actor: {
      name: displayName,
      slug,
      image,
      roles: Array.from(roles),
    },
    page,
    pages: Math.ceil(total / limit) || 1,
    total,
    movies: rows.map((m) => ({
      _id: m._id,
      slug: m.slug,
      name: m.name,
      titleImage: m.titleImage,
      image: m.image,
      thumbnailInfo: m.thumbnailInfo,
      type: m.type,
      category: m.category,
      year: m.year,
    })),
  });
});
