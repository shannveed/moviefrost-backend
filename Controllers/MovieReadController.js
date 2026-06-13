// backend/Controllers/MovieReadController.js
import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';

import Movie from '../Models/MoviesModel.js';

const publicVisibilityFilter = { isPublished: { $ne: false } };

const clean = (value = '') => String(value ?? '').trim();

const isValidObjectId = (value) => {
  const id = clean(value);
  return /^[a-f\d]{24}$/i.test(id) && mongoose.Types.ObjectId.isValid(id);
};

const populateReviews = {
  path: 'reviews.userId',
  select: 'fullName image',
};

const findMovieByIdOrSlugReadOnly = async (param, extraFilter = {}) => {
  const safe = clean(param);
  if (!safe) return null;

  const baseFilter = { ...extraFilter };

  if (isValidObjectId(safe)) {
    const byId = await Movie.findOne({ _id: safe, ...baseFilter })
      .populate(populateReviews)
      .lean();

    if (byId) return byId;
  }

  return Movie.findOne({ slug: safe, ...baseFilter })
    .populate(populateReviews)
    .lean();
};

/**
 * PUBLIC
 * GET /api/movies/:id
 *
 * Read-only:
 * - does NOT increment viewCount
 * - does NOT call TMDb
 * - does NOT call OMDb
 * - does NOT update updatedAt
 */
export const getMovieByIdReadOnly = asyncHandler(async (req, res) => {
  const movie = await findMovieByIdOrSlugReadOnly(
    req.params.id,
    publicVisibilityFilter
  );

  if (!movie) {
    res.status(404);
    throw new Error('Movie not found');
  }

  res
    .set(
      'Cache-Control',
      'public, max-age=120, s-maxage=120, stale-while-revalidate=1800'
    )
    .json(movie);
});

/**
 * ADMIN
 * GET /api/movies/admin/:id
 *
 * Read-only admin preview:
 * - includes drafts
 * - no view increment
 * - no external API sync
 */
export const getMovieByIdAdminReadOnly = asyncHandler(async (req, res) => {
  const movie = await findMovieByIdOrSlugReadOnly(req.params.id, {});

  if (!movie) {
    res.status(404);
    throw new Error('Movie not found');
  }

  res.set('Cache-Control', 'private, no-store').json(movie);
});

/**
 * PUBLIC
 * POST /api/movies/:id/view
 *
 * Lightweight real-user view tracker.
 * Called by frontend only after:
 * - user interaction
 * - visible/focused tab
 * - active delay
 *
 * Uses native collection update so updatedAt is NEVER changed.
 */
export const recordMovieView = asyncHandler(async (req, res) => {
  const param = clean(req.params.id);

  if (!param) {
    res.status(400);
    throw new Error('Movie id or slug is required');
  }

  const movie = await findMovieByIdOrSlugReadOnly(param, {
    ...publicVisibilityFilter,
  });

  if (!movie?._id) {
    res.status(404);
    throw new Error('Movie not found');
  }

  await Movie.collection.updateOne(
    { _id: movie._id },
    { $inc: { viewCount: 1 } }
  );

  res
    .set('Cache-Control', 'no-store')
    .status(200)
    .json({ ok: true, movieId: movie._id });
});

export default {
  getMovieByIdReadOnly,
  getMovieByIdAdminReadOnly,
  recordMovieView,
};
