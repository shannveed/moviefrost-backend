// backend/Controllers/RelatedMoviesController.js
import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import Movie from '../Models/MoviesModel.js';

// Treat "missing isPublished" as published (same rule as your public movies endpoints)
const publicVisibilityFilter = { isPublished: { $ne: false } };

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

const buildLimit = (value, fallback = 20) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, 50); // safety cap
};

const escapeRegex = (value = '') =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Split category string into tokens.
 * Example: "Crime, Thriller, Suspense" => ["Crime", "Thriller", "Suspense"]
 * Supports common separators: comma, slash, pipe, semicolon, ampersand.
 */
const splitCategoryTokens = (categoryValue) => {
  if (!categoryValue) return [];

  const parts = String(categoryValue)
    .split(/[,/|;&]+/g)
    .map((s) => s.trim())
    .filter(Boolean);

  // De-dupe case-insensitively
  const seen = new Set();
  const unique = [];
  for (const p of parts) {
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(p);
  }
  return unique;
};

/**
 * Build regex that matches a token as a FULL category item inside a delimited string.
 * Example token "Crime" matches:
 *  - "Crime"
 *  - "Crime, Thriller"
 *  - "Thriller, Crime"
 * Does NOT match:
 *  - "Crimean" (partial)
 */
const buildDelimitedCategoryRegex = (token) => {
  const t = String(token || '').trim();
  if (!t) return null;

  const esc = escapeRegex(t);

  // delimiters we consider: comma, slash, pipe, semicolon, ampersand
  return new RegExp(`(^|\\s*[,/|;&]\\s*)${esc}(\\s*[,/|;&]\\s*|$)`, 'i');
};

const buildCategoryOrQuery = (categoryValue) => {
  const tokens = splitCategoryTokens(categoryValue);

  const ors = tokens
    .map((t) => buildDelimitedCategoryRegex(t))
    .filter(Boolean)
    .map((re) => ({ category: re }));

  return ors.length ? ors : null;
};

// Find movie by ObjectId or slug (lean + minimal fields)
const findMovieByIdOrSlugLean = async (param, extraFilter = {}) => {
  if (!param) return null;

  // Try ObjectId first
  if (isValidObjectId(param)) {
    const byId = await Movie.findOne({ _id: param, ...extraFilter })
      .select('_id slug category')
      .lean();
    if (byId) return byId;
  }

  // Fallback to slug
  const bySlug = await Movie.findOne({ slug: param, ...extraFilter })
    .select('_id slug category')
    .lean();

  return bySlug;
};

/**
 * PUBLIC
 * GET /api/movies/related/:id?limit=20
 * Only published titles included.
 */
export const getRelatedMovies = asyncHandler(async (req, res) => {
  const limit = buildLimit(req.query.limit, 20);

  const current = await findMovieByIdOrSlugLean(
    req.params.id,
    publicVisibilityFilter
  );

  if (!current) {
    res.status(404);
    throw new Error('Movie not found');
  }

  const categoryOr = buildCategoryOrQuery(current.category);

  const related = await Movie.find({
    ...publicVisibilityFilter,
    _id: { $ne: current._id },
    ...(categoryOr ? { $or: categoryOr } : { category: current.category }),
  })
    .sort({ latest: -1, orderIndex: 1, createdAt: -1 })
    .limit(limit)
    .select('_id slug name titleImage thumbnailInfo type category image')
    .lean();

  res.json(related);
});

/**
 * ADMIN
 * GET /api/movies/admin/related/:id?limit=20
 * Includes drafts/unpublished too.
 */
export const getRelatedMoviesAdmin = asyncHandler(async (req, res) => {
  const limit = buildLimit(req.query.limit, 20);

  const current = await findMovieByIdOrSlugLean(req.params.id, {});

  if (!current) {
    res.status(404);
    throw new Error('Movie not found');
  }

  const categoryOr = buildCategoryOrQuery(current.category);

  const related = await Movie.find({
    _id: { $ne: current._id },
    ...(categoryOr ? { $or: categoryOr } : { category: current.category }),
  })
    .sort({ latest: -1, orderIndex: 1, createdAt: -1 })
    .limit(limit)
    .select('_id slug name titleImage thumbnailInfo type category image isPublished')
    .lean();

  res.json(related);
});
