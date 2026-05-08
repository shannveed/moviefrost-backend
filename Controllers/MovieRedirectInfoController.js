// backend/Controllers/MovieRedirectInfoController.js
import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';

import Movie from '../Models/MoviesModel.js';

// Treat "missing isPublished" as published
const publicVisibilityFilter = { isPublished: { $ne: false } };

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

const clean = (value = '') => String(value ?? '').trim();

/**
 * PUBLIC
 * GET /api/movies/redirect-info/:id
 *
 * Lightweight movie lookup used by frontend middleware.
 * Important:
 * - Does NOT increment viewCount
 * - Does NOT trigger TMDb/OMDb side effects
 * - Only returns minimum fields needed for language-domain redirect
 */
export const getMovieRedirectInfo = asyncHandler(async (req, res) => {
  const param = clean(req.params.id);

  if (!param) {
    res.status(400);
    throw new Error('Movie id or slug is required');
  }

  const select = '_id slug type language isPublished';

  let movie = null;

  if (isValidObjectId(param)) {
    movie = await Movie.findOne({
      _id: param,
      ...publicVisibilityFilter,
    })
      .select(select)
      .lean();
  }

  if (!movie) {
    movie = await Movie.findOne({
      slug: param,
      ...publicVisibilityFilter,
    })
      .select(select)
      .lean();
  }

  if (!movie) {
    res.status(404);
    throw new Error('Movie not found');
  }

  res
    .set(
      'Cache-Control',
      'public, max-age=300, s-maxage=300, stale-while-revalidate=3600'
    )
    .json(movie);
});

export default {
  getMovieRedirectInfo,
};
