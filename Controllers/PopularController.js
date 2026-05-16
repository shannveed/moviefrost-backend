// backend/Controllers/PopularController.js
import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';

import Movie from '../Models/MoviesModel.js';

const POPULAR_PAGE_LIMIT = 30;
const POPULAR_REORDER_MAX = 1000;

// Treat "missing isPublished" as published
const publicVisibilityFilter = { isPublished: { $ne: false } };

const PUBLIC_POPULAR_SELECT =
  '_id slug name image titleImage thumbnailInfo type category browseBy time year language popular popularAt isPublished orderIndex rate numberOfReviews';

const ADMIN_POPULAR_SELECT =
  '_id slug name image titleImage thumbnailInfo type category browseBy time year language popular popularAt isPublished orderIndex createdAt updatedAt';

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

const clampLimit = (value, fallback = POPULAR_PAGE_LIMIT, max = 200) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
};

const normalizeTypeParam = (value) => {
  const v = String(value || '').trim();
  if (!v) return null;

  const lower = v.toLowerCase();

  if (lower === 'movie' || lower === 'movies') return 'Movie';

  if (
    lower === 'webseries' ||
    lower === 'web-series' ||
    lower === 'web series' ||
    lower === 'tvshows' ||
    lower === 'tv-shows' ||
    lower === 'tv shows' ||
    lower === 'series'
  ) {
    return 'WebSeries';
  }

  return null;
};

const buildPopularTypeFilter = (value) => {
  const type = normalizeTypeParam(value);
  return type ? { type } : {};
};

const uniqueValidIds = (ids = []) => {
  const unique = [
    ...new Set(
      (Array.isArray(ids) ? ids : [])
        .map((id) => String(id || '').trim())
        .filter(Boolean)
    ),
  ];

  return unique.filter((id) => isValidObjectId(id));
};

/**
 * PUBLIC
 * GET /api/movies/popular?type=Movie&pageNumber=1&limit=30
 *
 * Only published titles.
 */
export const getPopularMovies = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.pageNumber) || 1);
  const limit = clampLimit(req.query.limit, POPULAR_PAGE_LIMIT, 200);
  const skip = (page - 1) * limit;

  const typeFilter = buildPopularTypeFilter(req.query.type);

  const filter = {
    ...publicVisibilityFilter,
    popular: true,
    ...typeFilter,
  };

  const [movies, totalMovies] = await Promise.all([
    Movie.find(filter)
      .sort({ popularAt: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select(PUBLIC_POPULAR_SELECT)
      .lean(),
    Movie.countDocuments(filter),
  ]);

  res
    .set(
      'Cache-Control',
      'public, max-age=60, s-maxage=60, stale-while-revalidate=600'
    )
    .json({
      movies,
      page,
      pages: Math.ceil(totalMovies / limit) || 1,
      totalMovies,
    });
});

/**
 * ADMIN
 * GET /api/movies/admin/popular?type=Movie&pageNumber=1&limit=30
 *
 * Includes drafts/unpublished too.
 */
export const getPopularMoviesAdmin = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.pageNumber) || 1);
  const limit = clampLimit(req.query.limit, POPULAR_PAGE_LIMIT, 200);
  const skip = (page - 1) * limit;

  const typeFilter = buildPopularTypeFilter(req.query.type);

  const filter = {
    popular: true,
    ...typeFilter,
  };

  const [movies, totalMovies] = await Promise.all([
    Movie.find(filter)
      .sort({ popularAt: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select(ADMIN_POPULAR_SELECT)
      .lean(),
    Movie.countDocuments(filter),
  ]);

  res.json({
    movies,
    page,
    pages: Math.ceil(totalMovies / limit) || 1,
    totalMovies,
  });
});

/**
 * ADMIN
 * POST /api/movies/admin/popular
 *
 * body: { movieIds: [...], value: true|false }
 */
export const setPopularMovies = asyncHandler(async (req, res) => {
  const { movieIds, value = true } = req.body || {};

  if (!Array.isArray(movieIds) || movieIds.length === 0) {
    res.status(400);
    throw new Error('movieIds array is required');
  }

  const validIds = uniqueValidIds(movieIds);

  if (!validIds.length) {
    res.status(400);
    throw new Error('No valid movieIds provided');
  }

  const boolValue = !!value;
  const now = new Date();

  const update = boolValue
    ? { $set: { popular: true, popularAt: now } }
    : { $set: { popular: false, popularAt: null } };

  const result = await Movie.updateMany({ _id: { $in: validIds } }, update);

  res.status(200).json({
    message: boolValue ? 'Added to Popular' : 'Removed from Popular',
    matched: result.matchedCount ?? result.n ?? 0,
    modified: result.modifiedCount ?? result.nModified ?? 0,
  });
});

/**
 * ADMIN
 * POST /api/movies/admin/popular/reorder
 *
 * body:
 * {
 *   orderedIds: [movieId1, movieId2, ...],
 *   type: "Movie" | "WebSeries" // optional, recommended
 * }
 *
 * Persists the Popular order by rewriting popularAt timestamps.
 * Sorting stays: popularAt desc, createdAt desc.
 */
export const reorderPopularMovies = asyncHandler(async (req, res) => {
  const { orderedIds, type } = req.body || {};

  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    res.status(400);
    throw new Error('orderedIds array is required');
  }

  const validIds = uniqueValidIds(orderedIds);

  if (!validIds.length) {
    res.status(400);
    throw new Error('No valid orderedIds provided');
  }

  const typeFilter = buildPopularTypeFilter(type);

  const popularDocs = await Movie.find({
    popular: true,
    ...typeFilter,
  })
    .sort({ popularAt: -1, createdAt: -1 })
    .select('_id')
    .lean();

  if (!popularDocs.length) {
    res.status(404);
    throw new Error('No Popular titles found to reorder');
  }

  if (popularDocs.length > POPULAR_REORDER_MAX) {
    res.status(400);
    throw new Error(
      `Too many Popular titles (${popularDocs.length}). Reduce before reordering.`
    );
  }

  const allIds = popularDocs.map((m) => String(m._id));
  const allSet = new Set(allIds);

  // Only IDs that actually belong to the current popular list/type
  const orderedInList = validIds.filter((id) => allSet.has(String(id)));

  if (!orderedInList.length) {
    res.status(400);
    throw new Error('None of the provided IDs belong to the Popular list');
  }

  // Final order = provided order first, then existing remaining titles
  const orderedSet = new Set(orderedInList.map(String));
  const remaining = allIds.filter((id) => !orderedSet.has(id));
  const finalOrder = [...orderedInList, ...remaining];

  const now = Date.now();

  const bulkOps = finalOrder.map((id, idx) => ({
    updateOne: {
      filter: { _id: id },
      update: { $set: { popularAt: new Date(now - idx * 1000) } },
    },
  }));

  await Movie.bulkWrite(bulkOps, { ordered: true });

  res.status(200).json({
    message: 'Popular order updated successfully',
    type: normalizeTypeParam(type) || null,
    totalPopular: allIds.length,
    reorderedCount: orderedInList.length,
  });
});

export default {
  getPopularMovies,
  getPopularMoviesAdmin,
  setPopularMovies,
  reorderPopularMovies,
};
