// backend/Controllers/BannerController.js
import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import Movie from '../Models/MoviesModel.js';

const BANNER_LIMIT = 10;

// Treat "missing isPublished" as published
const publicVisibilityFilter = { isPublished: { $ne: false } };

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

const clampLimit = (value, fallback = BANNER_LIMIT, max = 50) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
};

/**
 * PUBLIC
 * GET /api/movies/banner?limit=10
 * Only published.
 */
export const getBannerMovies = asyncHandler(async (req, res) => {
  const limit = clampLimit(req.query.limit, BANNER_LIMIT, 50);

  const movies = await Movie.find({
    ...publicVisibilityFilter,
    banner: true,
  })
    .sort({ bannerAt: -1, createdAt: -1 })
    .limit(limit)
    .select(
      '_id slug name image titleImage thumbnailInfo type category time year language banner bannerAt'
    )
    .lean();

  res.json(movies);
});

/**
 * ADMIN
 * GET /api/movies/admin/banner?limit=10
 * Includes drafts.
 */
export const getBannerMoviesAdmin = asyncHandler(async (req, res) => {
  const limit = clampLimit(req.query.limit, BANNER_LIMIT, 50);

  const movies = await Movie.find({
    banner: true,
  })
    .sort({ bannerAt: -1, createdAt: -1 })
    .limit(limit)
    .select(
      '_id slug name image titleImage thumbnailInfo type category time year language banner bannerAt isPublished'
    )
    .lean();

  res.json(movies);
});

/**
 * ADMIN
 * POST /api/movies/admin/banner
 * body: { movieIds: [...], value: true|false }
 */
export const setBannerMovies = asyncHandler(async (req, res) => {
  const { movieIds, value = true } = req.body || {};

  if (!Array.isArray(movieIds) || movieIds.length === 0) {
    res.status(400);
    throw new Error('movieIds array is required');
  }

  const validIds = movieIds.filter((id) => isValidObjectId(id));
  if (!validIds.length) {
    res.status(400);
    throw new Error('No valid movieIds provided');
  }

  const boolValue = !!value;
  const now = new Date();

  const update = boolValue
    ? { $set: { banner: true, bannerAt: now } }
    : { $set: { banner: false, bannerAt: null } };

  const result = await Movie.updateMany({ _id: { $in: validIds } }, update);

  res.status(200).json({
    message: boolValue ? 'Added to Banner' : 'Removed from Banner',
    matched: result.matchedCount ?? result.n ?? 0,
    modified: result.modifiedCount ?? result.nModified ?? 0,
  });
});
