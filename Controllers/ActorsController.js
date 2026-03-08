// backend/Controllers/ActorsController.js
import asyncHandler from 'express-async-handler';
import Movie from '../Models/MoviesModel.js';
import { escapeRegex, slugify } from '../utils/slugify.js';

const publicVisibilityFilter = { isPublished: { $ne: false } };

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 100;
const PLACEHOLDER_IMAGE = '/images/placeholder.jpg';

const clampPositiveInt = (value, fallback = DEFAULT_LIMIT, max = MAX_LIMIT) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
};

const titleCaseFromSlug = (slug = '') =>
  String(slug || '')
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
    .trim();

const buildNameRegexFromSlug = (slug = '') => {
  const guess = String(slug || '')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!guess) return null;

  return new RegExp(
    `^${escapeRegex(guess).replace(/\s+/g, '\\s+')}$`,
    'i'
  );
};

const matchesActorEntry = (entry, targetSlug, nameRegex) => {
  const s = String(entry?.slug || '').trim().toLowerCase();
  const n = String(entry?.name || '').trim();

  if (s && s === targetSlug) return true;
  if (nameRegex && n && nameRegex.test(n)) return true;
  if (!s && n && slugify(n) === targetSlug) return true;

  return false;
};

const matchesDirector = (movieLike, targetSlug, nameRegex) => {
  const s = String(movieLike?.directorSlug || '').trim().toLowerCase();
  const n = String(movieLike?.director || '').trim();

  if (s && s === targetSlug) return true;
  if (nameRegex && n && nameRegex.test(n)) return true;
  if (!s && n && slugify(n) === targetSlug) return true;

  return false;
};

/**
 * PUBLIC
 * GET /api/actors/:slug?page=1&limit=24
 */
export const getActorBySlug = asyncHandler(async (req, res) => {
  const rawSlug = String(req.params.slug || '').trim().toLowerCase();

  if (!rawSlug) {
    res.status(400);
    throw new Error('Actor slug is required');
  }

  const page = clampPositiveInt(req.query.page, 1, 100000);
  const limit = clampPositiveInt(req.query.limit, DEFAULT_LIMIT, MAX_LIMIT);
  const skip = (page - 1) * limit;

  const nameRegex = buildNameRegexFromSlug(rawSlug);

  const actorOr = [{ 'casts.slug': rawSlug }];
  const directorOr = [{ directorSlug: rawSlug }];

  if (nameRegex) {
    actorOr.push({ 'casts.name': nameRegex });
    directorOr.push({ director: nameRegex });
  }

  const filter = {
    ...publicVisibilityFilter,
    $or: [...actorOr, ...directorOr],
  };

  const [total, movies, actorProbe, directorProbe] = await Promise.all([
    Movie.countDocuments(filter),

    Movie.find(filter)
      .sort({ latest: -1, orderIndex: 1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('_id slug name titleImage thumbnailInfo type category image year')
      .lean(),

    Movie.findOne({ ...publicVisibilityFilter, $or: actorOr })
      .select('casts')
      .lean(),

    Movie.findOne({ ...publicVisibilityFilter, $or: directorOr })
      .select('director directorSlug')
      .lean(),
  ]);

  if (!total) {
    res.status(404);
    throw new Error('Actor not found');
  }

  let actorName = '';
  let actorImage = '';

  if (Array.isArray(actorProbe?.casts)) {
    const castMatch = actorProbe.casts.find((c) =>
      matchesActorEntry(c, rawSlug, nameRegex)
    );

    if (castMatch) {
      actorName = String(castMatch.name || '').trim();
      actorImage = String(castMatch.image || '').trim();
    }
  }

  if (!actorName && matchesDirector(directorProbe, rawSlug, nameRegex)) {
    actorName = String(directorProbe?.director || '').trim();
  }

  const roles = [];
  if (actorProbe) roles.push('actor');
  if (directorProbe) roles.push('director');

  res.status(200).json({
    actor: {
      slug: rawSlug,
      name: actorName || titleCaseFromSlug(rawSlug) || 'Actor',
      image: actorImage || PLACEHOLDER_IMAGE,
      roles: roles.length ? roles : ['actor'],
    },
    movies,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
    total,
  });
});
